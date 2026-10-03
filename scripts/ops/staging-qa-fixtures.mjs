#!/usr/bin/env node
// Staging QA fixtures (Phase 2, P2-AC-16): converges the staging deployment to a known set of clearly
// labelled QA Editions through the REAL admin API (the same HTTP commands the Admin UI will call) -- never
// raw SQL, never a service-role write to application tables.
//
// What it creates (idempotent: a re-run creates nothing that already exists):
//   * the four platform legal documents (TERMS_OF_SERVICE, PRIVACY_NOTICE, SPORT_WAIVER, MINOR_TERMS) get a
//     PUBLISHED version ONLY when the document has none, with a text that says it is a QA placeholder and
//     NOT legal text (no legal text is invented; PEND-LEGAL-001/002 stay open). Existing versions are never
//     superseded;
//   * `qa-p2-gratis`    FREE edition, open registration, 2 modalities (5K capacity 2, 10K capacity 5);
//   * `qa-p2-whatsapp`  EXTERNAL_WHATSAPP edition (fake number), open registration, 2 modalities (5K capacity 2,
//                       10K capacity 5, priced), USER_SELECTS categories on the 10K;
//   * per edition: a published edition-wide form (required SELECT, optional TEXT/TEXTAREA), a 10K form on the
//     WhatsApp edition, an EVENT_RULES document with a published QA version, a published description block.
// Output: ids and slugs only (stdout JSON). Progress goes to stderr. Secrets are never printed.
//
// Environment (injected by the orchestrator; this script never reads a file for secrets):
//   E2E_BASE_URL              https://staging.runiismty.com   (any other host is refused)
//   E2E_SUPABASE_URL          https://brxdgvcfykmsqmhsvgxl.supabase.co   (any other project is refused)
//   E2E_SUPABASE_SERVER_KEY   server (secret) key of the staging Supabase project (mints the admin OTP only)
//   E2E_VERCEL_BYPASS         Vercel Deployment Protection automation-bypass secret (staging only)
//   QA_ADMIN_EMAIL            email of the GLOBAL ADMIN account used to run the admin commands
//   QA_WHATSAPP_E164          optional fake handoff number for the WhatsApp edition (default +525555550100)
//   QA_FIXTURES_LOCAL=1       local dry run only: requires BOTH targets to be loopback (127.0.0.1:3100 and the
//                             local Supabase on 54621); NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY are
//                             accepted as fallbacks for the Supabase pair (same names bootstrap-admin.mjs uses)
// Refused regardless: APP_ENV=production, VERCEL_ENV=production, ALLOW_PRODUCTION_MUTATIONS=true.
//
// Admin identity (how the script gets a GLOBAL ADMIN session without a password):
//   1. `QA_ADMIN_EMAIL=<email> node scripts/ops/staging-qa-fixtures.mjs --prepare-admin` ensures the Supabase
//      Auth account exists (no profile, no role). Prints the masked email.
//   2. The orchestrator grants GLOBAL ADMIN to that account with the existing first-admin bootstrap:
//      `node scripts/ops/bootstrap-admin.mjs <email>` (only works while no ACTIVE GLOBAL ADMIN exists; otherwise
//      an existing ADMIN grants the role through POST /api/v1/admin/staff).
//   3. `node scripts/ops/staging-qa-fixtures.mjs` mints a one-time OTP for that email with the Supabase admin API
//      (auth.admin.generateLink -> properties.email_otp), verifies it through the app's own
//      POST /api/v1/auth/verify, and keeps the resulting HttpOnly session cookies in memory only.
//
// Modes: (default) converge; --plan read-only (prints what would be created); --prepare-admin (step 1).

import { createClient } from "@supabase/supabase-js";
import { pathToFileURL } from "node:url";

export const STAGING_SUPABASE_REF = "brxdgvcfykmsqmhsvgxl";
export const STAGING_HOST = "staging.runiismty.com";
const LOCAL_APP_ORIGIN = "http://127.0.0.1:3100";
const LOCAL_SUPABASE_PORT = "54621";
const LOOPBACK = new Set(["127.0.0.1", "localhost"]);

export class FixtureError extends Error {}

function clean(value) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** Pure target guard: throws FixtureError unless the target is the staging project (or, in explicit local mode,
 * the local stack). Exported for the unit test; never prints secrets. */
export function resolveConfig(env, argv = []) {
  const local = clean(env.QA_FIXTURES_LOCAL) === "1";
  if (clean(env.APP_ENV) === "production" || clean(env.VERCEL_ENV) === "production" || clean(env.ALLOW_PRODUCTION_MUTATIONS) === "true") {
    throw new FixtureError("refused: this environment is marked as production");
  }

  const rawBase = clean(env.E2E_BASE_URL) ?? (local ? LOCAL_APP_ORIGIN : undefined);
  const rawSupabase = clean(env.E2E_SUPABASE_URL) ?? clean(env.NEXT_PUBLIC_SUPABASE_URL);
  const serverKey = clean(env.E2E_SUPABASE_SERVER_KEY) ?? clean(env.SUPABASE_SECRET_KEY);
  if (!rawBase) throw new FixtureError("missing E2E_BASE_URL");
  if (!rawSupabase) throw new FixtureError("missing E2E_SUPABASE_URL");
  if (!serverKey) throw new FixtureError("missing E2E_SUPABASE_SERVER_KEY");

  let base;
  let supabase;
  try {
    base = new URL(rawBase);
    supabase = new URL(rawSupabase);
  } catch {
    throw new FixtureError("E2E_BASE_URL / E2E_SUPABASE_URL must be valid URLs");
  }

  if (local) {
    if (!LOOPBACK.has(base.hostname) || base.protocol !== "http:") throw new FixtureError("refused: local mode requires a loopback http E2E_BASE_URL");
    if (!LOOPBACK.has(supabase.hostname) || supabase.port !== LOCAL_SUPABASE_PORT) {
      throw new FixtureError(`refused: local mode requires the local Supabase on port ${LOCAL_SUPABASE_PORT}`);
    }
  } else {
    if (base.protocol !== "https:" || base.hostname !== STAGING_HOST) throw new FixtureError(`refused: E2E_BASE_URL must be https://${STAGING_HOST}`);
    if (supabase.protocol !== "https:" || supabase.hostname !== `${STAGING_SUPABASE_REF}.supabase.co`) {
      throw new FixtureError(`refused: E2E_SUPABASE_URL must be the staging project (${STAGING_SUPABASE_REF})`);
    }
  }

  const bypass = clean(env.E2E_VERCEL_BYPASS);
  if (bypass !== undefined && local) throw new FixtureError("E2E_VERCEL_BYPASS is only for the remote staging target");

  const whatsapp = clean(env.QA_WHATSAPP_E164) ?? "+525555550100";
  if (!/^\+[1-9][0-9]{7,14}$/.test(whatsapp)) throw new FixtureError("QA_WHATSAPP_E164 must be E.164");

  const mode = argv.includes("--prepare-admin") ? "prepare-admin" : argv.includes("--plan") ? "plan" : "converge";
  const adminEmail = clean(env.QA_ADMIN_EMAIL);
  if (!adminEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) throw new FixtureError("missing or invalid QA_ADMIN_EMAIL");

  return { local, mode, baseUrl: base.origin, supabaseUrl: supabase.origin, serverKey, bypass, adminEmail, whatsapp };
}

export function maskEmail(email) {
  const [name, domain] = email.split("@");
  return `${name.slice(0, 2)}***@${domain}`;
}

const PLACEHOLDER = (what) =>
  `[QA STAGING PLACEHOLDER - NO ES TEXTO LEGAL]\n\nTexto de prueba (${what}) para el entorno de staging de RUNIIS. ` +
  "El contenido legal definitivo esta pendiente de la revision del propietario (PEND-LEGAL-001/002) y no debe usarse en produccion.";

const GLOBAL_DOCUMENTS = ["TERMS_OF_SERVICE", "PRIVACY_NOTICE", "SPORT_WAIVER", "MINOR_TERMS"];

function eventDate() {
  return new Date(Date.now() + 120 * 86_400_000).toISOString().slice(0, 10);
}

/** Declarative fixture set. Names carry "QA" so nobody mistakes them for real events. */
export function fixtureSpecs(whatsapp) {
  const shirtOptions = ["XS", "S", "M", "L", "XL"].map((value) => ({ value, label: value }));
  const wideForm = {
    modality: null,
    fields: [
      { field_key: "shirt_size", label: "Talla de playera", field_type: "SELECT", required: true, options_config: { options: shirtOptions }, sort_order: 1 },
      { field_key: "club", label: "Club o equipo (opcional)", field_type: "TEXT", required: false, validation_config: { max_length: 80 }, sort_order: 2 },
      { field_key: "medical_notes", label: "Notas medicas (opcional)", field_type: "TEXTAREA", required: false, sensitivity: "SENSITIVE", validation_config: { max_length: 500 }, sort_order: 3 },
    ],
  };
  return [
    {
      slug: "qa-p2-gratis",
      eventName: "QA P2 Carrera Gratis (datos de prueba)",
      editionName: "QA P2 Gratis - carrera de prueba",
      mode: "FREE",
      modalities: [
        { key: "5k", name: "5K QA", distance: 5000, capacity: 2, price: 0, sort: 1 },
        { key: "10k", name: "10K QA", distance: 10000, capacity: 5, price: 0, sort: 2 },
      ],
      categories: [],
      forms: [wideForm],
      description: "[QA] Evento de prueba gratuito de la Fase 2 de RUNIIS. No es un evento real: sirve para validar la inscripcion FREE de punta a punta.",
    },
    {
      slug: "qa-p2-whatsapp",
      eventName: "QA P2 Carrera WhatsApp (datos de prueba)",
      editionName: "QA P2 WhatsApp - carrera de prueba",
      mode: "EXTERNAL_WHATSAPP",
      whatsapp,
      modalities: [
        { key: "5k", name: "5K QA", distance: 5000, capacity: 2, price: 25000, sort: 1 },
        { key: "10k", name: "10K QA", distance: 10000, capacity: 5, price: 35000, sort: 2 },
      ],
      categories: [
        { key: "recreativa", name: "Recreativa QA", mode: "USER_SELECTS", modalities: ["10k"], sort: 1 },
        { key: "competitiva", name: "Competitiva QA", mode: "USER_SELECTS", modalities: ["10k"], sort: 2 },
      ],
      forms: [
        wideForm,
        { modality: "10k", fields: [{ field_key: "pace", label: "Ritmo estimado (min/km, opcional)", field_type: "NUMBER", required: false, validation_config: { min: 3, max: 12 }, sort_order: 1 }] },
      ],
      description: "[QA] Evento de prueba con registro por WhatsApp de la Fase 2 de RUNIIS. No es un evento real: el numero de contacto es de prueba.",
    },
  ];
}

class ApiError extends Error {
  constructor(method, path, status, code, reason) {
    super(`${method} ${path} -> ${status} ${code}${reason ? ` (${reason})` : ""}`);
    this.status = status;
    this.code = code;
  }
}

function createClientSession(cfg) {
  const jar = new Map();
  const log = (message) => process.stderr.write(`${message}\n`);

  async function request(method, path, body, headers = {}, attempt = 0) {
    const requestHeaders = { accept: "application/json", ...headers };
    if (body !== undefined) requestHeaders["content-type"] = "application/json";
    if (cfg.bypass) requestHeaders["x-vercel-protection-bypass"] = cfg.bypass;
    if (jar.size > 0) requestHeaders.cookie = [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
    const response = await fetch(new URL(path, cfg.baseUrl), {
      method,
      headers: requestHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
    });
    for (const setCookie of response.headers.getSetCookie?.() ?? []) {
      const [pair] = setCookie.split(";");
      const eq = pair.indexOf("=");
      if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (response.status === 429 && attempt < 3) {
      const wait = Math.min(Number(payload?.error?.details?.retry_after_seconds ?? response.headers.get("retry-after") ?? 20) || 20, 70);
      log(`rate limited on ${method} ${path}; waiting ${wait}s`);
      await new Promise((resolve) => setTimeout(resolve, wait * 1000));
      return request(method, path, body, headers, attempt + 1);
    }
    if (!response.ok) {
      const error = payload?.error;
      throw new ApiError(method, path, response.status, error?.code ?? "HTTP_ERROR", error?.details?.reason);
    }
    return payload;
  }

  return {
    log,
    get: (path) => request("GET", path),
    post: (path, body, idempotencyKey) => request("POST", path, body ?? {}, idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
    async signIn() {
      const supabase = createClient(cfg.supabaseUrl, cfg.serverKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
      const link = await supabase.auth.admin.generateLink({ type: "magiclink", email: cfg.adminEmail });
      const code = link.data?.properties?.email_otp;
      if (link.error || !code) throw new FixtureError("could not mint an admin OTP (check the server key and QA_ADMIN_EMAIL)");
      await request("POST", "/api/v1/auth/verify", { email: cfg.adminEmail, code });
    },
  };
}

async function prepareAdmin(cfg) {
  const supabase = createClient(cfg.supabaseUrl, cfg.serverKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const link = await supabase.auth.admin.generateLink({ type: "magiclink", email: cfg.adminEmail });
  if (link.error || !link.data?.user) throw new FixtureError("could not ensure the admin account (check the server key and QA_ADMIN_EMAIL)");
  process.stdout.write(`${JSON.stringify({ ok: true, mode: "prepare-admin", admin: maskEmail(cfg.adminEmail), next: "grant GLOBAL ADMIN with scripts/ops/bootstrap-admin.mjs" })}\n`);
}

async function ensureAdmin(api) {
  try {
    await api.get("/api/v1/admin/platform-settings");
  } catch (error) {
    if (error instanceof ApiError && (error.status === 403 || error.status === 401)) {
      throw new FixtureError("ADMIN_ROLE_MISSING: the QA admin account has no GLOBAL ADMIN role yet (run scripts/ops/bootstrap-admin.mjs <email>)");
    }
    throw error;
  }
}

async function ensureGlobalLegal(api, plan, summary) {
  const documents = (await api.get("/api/v1/admin/legal")).data;
  for (const type of GLOBAL_DOCUMENTS) {
    let document = documents.find((d) => d.document_type === type && d.status === "ACTIVE");
    if (!document) {
      if (plan) {
        summary.legal.push({ type, action: "would create document + placeholder version" });
        continue;
      }
      api.log(`creating legal document ${type}`);
      document = { ...(await api.post("/api/v1/admin/legal", { document_type: type })).data, current_version: null };
    }
    if (document.current_version) {
      summary.legal.push({ type, key: document.document_key, version: document.current_version.version, action: "kept existing published version" });
      continue;
    }
    if (plan) {
      summary.legal.push({ type, key: document.document_key, action: "would publish a QA placeholder version" });
      continue;
    }
    api.log(`publishing QA placeholder for ${type}`);
    const version = (await api.post(`/api/v1/admin/legal/${document.legal_document_id}/versions`, { content_markdown: PLACEHOLDER(type) })).data;
    await api.post(`/api/v1/admin/legal/versions/${version.legal_document_version_id}/publish`, {}, `qa-p2-publish-${version.legal_document_version_id}`);
    summary.legal.push({ type, key: document.document_key, action: "published QA placeholder", legal_document_version_id: version.legal_document_version_id });
  }
  return (await api.get("/api/v1/admin/legal")).data;
}

async function findEdition(api, slug) {
  const items = (await api.get(`/api/v1/admin/events?search=${encodeURIComponent(slug)}&limit=50`)).data;
  return items.find((item) => item.slug === slug) ?? null;
}

async function ensureEdition(api, spec, plan, legalDocuments) {
  const out = { slug: spec.slug, registration_mode: spec.mode, actions: [] };
  const note = (action) => out.actions.push(action);

  let found = await findEdition(api, spec.slug);
  if (!found) {
    note("create event + edition");
    if (plan) return out;
    api.log(`creating ${spec.slug}`);
    const event = (await api.post("/api/v1/admin/events", { event_type_key: "ROAD_RACE", name: spec.eventName, canonical_key: spec.slug }, `qa-p2-event-${spec.slug}`)).data;
    await api.post(
      "/api/v1/admin/editions",
      {
        event_id: event.event_id,
        slug: spec.slug,
        name: spec.editionName,
        registration_mode: spec.mode,
        city: "Monterrey",
        state_region: "NL",
        country_code: "MX",
        ...(spec.mode === "EXTERNAL_WHATSAPP" ? { whatsapp_phone_e164: spec.whatsapp } : {}),
        schedule: { local_date: eventDate(), local_start_time: "07:00:00" },
      },
      `qa-p2-edition-${spec.slug}`,
    );
    found = await findEdition(api, spec.slug);
    if (!found) throw new FixtureError(`edition ${spec.slug} was not found after creation`);
  }
  const editionId = found.edition_id;
  const editor = async () => (await api.get(`/api/v1/admin/editions/${editionId}`)).data;
  let state = await editor();

  // Modalities, capacity, price.
  const modalityIds = {};
  for (const m of spec.modalities) {
    let modality = state.modalities.find((x) => x.key === m.key);
    if (!modality) {
      note(`create modality ${m.key}`);
      if (plan) continue;
      api.log(`  modality ${m.key}`);
      modality = (await api.post(`/api/v1/admin/editions/${editionId}/modalities`, { key: m.key, name: m.name, official_distance_m: m.distance, sort_order: m.sort }, `qa-p2-mod-${spec.slug}-${m.key}`)).data;
      modality = { ...modality, price_offers: [] };
    }
    modalityIds[m.key] = modality.modality_id;
    if (modality.effective_capacity === null || modality.effective_capacity === undefined) {
      note(`set capacity ${m.key}=${m.capacity}`);
      if (!plan) await api.post(`/api/v1/admin/modalities/${modality.modality_id}/capacity`, { effective_capacity: m.capacity });
    }
    if ((modality.price_offers ?? []).length === 0) {
      note(`create price ${m.key}=${m.price}`);
      if (!plan) await api.post(`/api/v1/admin/modalities/${modality.modality_id}/prices`, { name: "General QA", amount_minor: m.price }, `qa-p2-price-${spec.slug}-${m.key}`);
    }
  }

  // Categories.
  for (const c of spec.categories) {
    if (state.categories.some((x) => x.key === c.key)) continue;
    note(`create category ${c.key}`);
    if (plan) continue;
    await api.post(`/api/v1/admin/editions/${editionId}/categories`, {
      key: c.key,
      name: c.name,
      assignment_mode: c.mode,
      sort_order: c.sort,
      modality_ids: c.modalities.map((key) => modalityIds[key]).filter(Boolean),
    });
  }

  // Forms (one PUBLISHED form per scope; an existing published form is never superseded).
  for (const form of spec.forms) {
    const modalityId = form.modality ? (modalityIds[form.modality] ?? null) : null;
    if (form.modality && !modalityId) continue; // plan mode before the modality exists
    const published = state.registration_forms.some((f) => f.status === "PUBLISHED" && (f.modality_id ?? null) === modalityId);
    if (published) continue;
    note(`create + publish form ${form.modality ?? "edition-wide"}`);
    if (plan) continue;
    const created = (await api.post(`/api/v1/admin/editions/${editionId}/forms`, { ...(modalityId ? { modality_id: modalityId } : {}), fields: form.fields })).data;
    await api.post(`/api/v1/admin/forms/${created.registration_form_id}/publish`, {}, `qa-p2-form-${created.registration_form_id}`);
  }

  // Event rules document with a published QA version.
  let rules = legalDocuments.find((d) => d.document_type === "EVENT_RULES" && d.edition_id === editionId);
  if (!rules) {
    note("create EVENT_RULES document");
    if (!plan) {
      const created = (await api.post("/api/v1/admin/legal", { document_type: "EVENT_RULES", edition_id: editionId })).data;
      rules = { ...created, current_version: null };
    }
  }
  if (rules && !rules.current_version) {
    note("publish EVENT_RULES QA version");
    if (!plan) {
      const version = (await api.post(`/api/v1/admin/legal/${rules.legal_document_id}/versions`, { content_markdown: PLACEHOLDER(`reglamento ${spec.slug}`) })).data;
      await api.post(`/api/v1/admin/legal/versions/${version.legal_document_version_id}/publish`, {}, `qa-p2-publish-${version.legal_document_version_id}`);
    }
  }

  // Published description block (publication readiness needs >= 30 characters).
  if (!state.content_blocks.some((b) => b.block_type === "RICH_TEXT" && b.status === "PUBLISHED")) {
    note("create description block");
    if (!plan) await api.post(`/api/v1/admin/editions/${editionId}/content-blocks`, { block_type: "RICH_TEXT", status: "PUBLISHED", payload: { markdown: spec.description } });
  }

  // Publish, then open registration.
  if (!plan) state = await editor();
  if (state.edition.publication_state !== "PUBLISHED") {
    note("publish edition");
    if (!plan) {
      try {
        await api.post(`/api/v1/admin/editions/${editionId}/publish`, {}, `qa-p2-publish-${editionId}`);
      } catch (error) {
        const failing = state.readiness.publication.checks.filter((c) => !c.ok).map((c) => c.code);
        throw new FixtureError(`publish ${spec.slug} refused (${error.message}); failing publication checks: ${failing.join(", ") || "none listed"}`);
      }
    }
  }
  if (!plan) state = await editor();
  if (state.edition.registration_state === "NOT_OPEN") {
    note("open registration");
    if (!plan) {
      try {
        await api.post(`/api/v1/admin/editions/${editionId}/open-registration`, {}, `qa-p2-open-${editionId}`);
      } catch (error) {
        const failing = state.readiness.registration.checks.filter((c) => !c.ok).map((c) => c.code);
        throw new FixtureError(`open-registration ${spec.slug} refused (${error.message}); failing registration checks: ${failing.join(", ") || "none listed"}`);
      }
    }
  }
  if (!plan) {
    state = await editor();
    out.edition_id = editionId;
    out.publication_state = state.edition.publication_state;
    out.registration_state = state.edition.registration_state;
    out.modalities = state.modalities.map((m) => ({ key: m.key, modality_id: m.modality_id, effective_capacity: m.effective_capacity }));
    out.categories = state.categories.map((c) => ({ key: c.key, category_id: c.category_id }));
  } else {
    out.edition_id = editionId;
  }
  return out;
}

export async function main(env = process.env, argv = process.argv.slice(2)) {
  const cfg = resolveConfig(env, argv);
  if (cfg.mode === "prepare-admin") return prepareAdmin(cfg);

  const api = createClientSession(cfg);
  await api.signIn();
  await ensureAdmin(api);
  const plan = cfg.mode === "plan";
  const summary = { ok: true, mode: cfg.mode, target: cfg.local ? "local" : "staging", legal: [], editions: [] };
  const legalDocuments = await ensureGlobalLegal(api, plan, summary);
  for (const spec of fixtureSpecs(cfg.whatsapp)) summary.editions.push(await ensureEdition(api, spec, plan, legalDocuments));
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    // Only the message: FixtureError/ApiError texts never contain secrets or response bodies.
    process.stderr.write(`${error instanceof Error ? error.message : "unexpected error"}\n`);
    process.exitCode = 1; // let open handles close; process.exit() trips a libuv assertion on Windows
  });
}
