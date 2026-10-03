import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import type { Browser, BrowserContext, Locator, Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createReadyUser, resetAuthIpBuckets, usesAdminOtp, type AccountUser, type PersonInput } from "./account";
import { scanForSeriousViolations } from "./axe";
import { protectBypass } from "./bypass";
import { BYPASS_HEADER, e2eEnv, type E2eEnv } from "./env";
import { expect as baseExpect, test as base } from "./fixtures";
import { adminOtpFor } from "./remote-auth";

/**
 * Phase 2 participant journeys (P2-E): fixtures and page helpers shared by tests/e2e/journeys/**.
 *
 * Isolation: every worker creates its own editions through the REAL admin API (the same HTTP commands the
 * Admin UI will call, via scripts/ops/staging-qa-fixtures.mjs), named `qa-e2e-<runId>-<tag>-<key>` with their
 * own capacities, registers only fixture users (qa.e2e.<run>-...@example.com remotely) and hides its editions
 * again when the worker ends. Nothing here ever targets `qa-p2-gratis` / `qa-p2-whatsapp` (owner-facing).
 * Admin identity is env-only (QA_ADMIN_EMAIL + the server-key OTP mechanism); nothing secret is written down.
 */

/** Screenshots land here; a Work Unit that reruns the journeys points E2E_EVIDENCE_DIR at its own evidence folder. */
export const EVIDENCE_DIR = process.env.E2E_EVIDENCE_DIR?.trim() || ".salvaops-agent-evidence/P2-E-journey-e2e";
export const LOCAL_ADMIN_EMAIL = "admin@runiis.test";
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

export const LOCAL_SQL_ONLY = "needs the local Docker DB for the state it fast-forwards (SQL); the remote target has no such lever";
export const NEEDS_FIXTURE_ADMIN = "needs QA_ADMIN_EMAIL + E2E_SUPABASE_URL + E2E_SUPABASE_SERVER_KEY to create isolated per-run editions on the remote target";

// ---------------------------------------------------------------------------------------------------------
// Fixture script (plain ESM, run with node; tsconfig has allowJs=false so it is loaded dynamically and typed here)
// ---------------------------------------------------------------------------------------------------------

export type FixtureEdition = {
  slug: string;
  edition_id: string;
  mode: "FREE" | "EXTERNAL_WHATSAPP";
  name: string;
  modalities: { key: string; modality_id: string; effective_capacity: number | null }[];
  categories: { key: string; category_id: string }[];
};
type FixtureApi = {
  get(path: string): Promise<{ data: unknown }>;
  post(path: string, body?: unknown, idempotencyKey?: string): Promise<{ data: unknown }>;
};
export type FixtureSession = { cfg: { local: boolean; baseUrl: string }; api: FixtureApi; legal: unknown };
export type FixtureScript = {
  resolveConfig(env: Record<string, string | undefined>, argv?: string[]): { local: boolean; baseUrl: string; supabaseUrl: string; adminEmail: string; bypass?: string };
  assertIsolatedSlug(slug: string): void;
  isolatedEditionSpec(options: { runId: string; key: string; mode: "FREE" | "EXTERNAL_WHATSAPP"; capacity?: number; whatsapp?: string }): {
    slug: string;
    mode: string;
    eventName: string;
    editionName: string;
    modalities: { key: string; capacity: number }[];
  };
  openFixtureSession(env?: Record<string, string | undefined>): Promise<FixtureSession>;
  createIsolatedEdition(session: FixtureSession, options: { runId: string; key: string; mode: "FREE" | "EXTERNAL_WHATSAPP"; capacity?: number }): Promise<FixtureEdition>;
  hideIsolatedEdition(session: FixtureSession, edition: Pick<FixtureEdition, "slug" | "edition_id">): Promise<boolean>;
};

let scriptPromise: Promise<FixtureScript> | null = null;
export function loadFixtureScript(): Promise<FixtureScript> {
  scriptPromise ??= import(/* webpackIgnore: true */ pathToFileURL(`${process.cwd()}/scripts/ops/staging-qa-fixtures.mjs`).href) as Promise<FixtureScript>;
  return scriptPromise;
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function isLoopback(baseURL: string): boolean {
  return LOOPBACK.has(new URL(baseURL).hostname);
}

/**
 * Pure: the environment handed to the fixture script (`resolveConfig`) for the current E2E mode. Staging runs get
 * the injected bypass / Supabase pair / QA_ADMIN_EMAIL; local runs and loopback rehearsals get the local stack
 * (QA_FIXTURES_LOCAL, seed admin, the dev-env Supabase pair). The production refusal flags are passed through so
 * the script's own guard keeps working. Never logged.
 */
export function fixtureEnv(e2e: E2eEnv = e2eEnv(), source: Record<string, string | undefined> = process.env): Record<string, string | undefined> {
  const loopback = isLoopback(e2e.baseURL);
  const env: Record<string, string | undefined> = {
    E2E_BASE_URL: e2e.baseURL,
    QA_ADMIN_EMAIL: clean(source.QA_ADMIN_EMAIL) ?? (loopback ? LOCAL_ADMIN_EMAIL : undefined),
    QA_WHATSAPP_E164: clean(source.QA_WHATSAPP_E164),
    APP_ENV: source.APP_ENV,
    VERCEL_ENV: source.VERCEL_ENV,
    ALLOW_PRODUCTION_MUTATIONS: source.ALLOW_PRODUCTION_MUTATIONS,
  };
  if (loopback) {
    env.QA_FIXTURES_LOCAL = "1";
    // E2E_SUPABASE_* of a loopback rehearsal point at the local stack already; otherwise the dev-env pair is used.
    if (e2e.adminOtp) {
      env.E2E_SUPABASE_URL = e2e.adminOtp.url;
      env.E2E_SUPABASE_SERVER_KEY = e2e.adminOtp.key;
    } else {
      env.NEXT_PUBLIC_SUPABASE_URL = source.NEXT_PUBLIC_SUPABASE_URL;
      env.SUPABASE_SECRET_KEY = source.SUPABASE_SECRET_KEY;
    }
  } else {
    env.E2E_VERCEL_BYPASS = e2e.bypassHeaders?.[BYPASS_HEADER];
    env.E2E_SUPABASE_URL = e2e.adminOtp?.url;
    env.E2E_SUPABASE_SERVER_KEY = e2e.adminOtp?.key;
  }
  return env;
}

/** Why journeys cannot create their isolated editions here (null = they can). */
export function journeyBlocker(e2e: E2eEnv = e2eEnv(), source: Record<string, string | undefined> = process.env): string | null {
  if (isLoopback(e2e.baseURL)) return null;
  if (!clean(source.QA_ADMIN_EMAIL) || !e2e.adminOtp) return NEEDS_FIXTURE_ADMIN;
  return null;
}

export function logFixture(entry: Record<string, unknown>): void {
  const e2e = e2eEnv();
  const line = JSON.stringify({ at: new Date().toISOString(), run_id: e2e.runId, target: new URL(e2e.baseURL).host, ...entry });
  try {
    mkdirSync(dirname(e2e.fixtureLog), { recursive: true });
    appendFileSync(e2e.fixtureLog, `${line}\n`);
  } catch {
    // The stdout echo below is the fallback record; never fail a journey over bookkeeping.
  }
  console.log(`[e2e-fixture] ${line}`);
}

const PROJECT_TAG: Record<string, string> = { "chromium-desktop": "d", "chromium-mobile": "m", "chromium-tablet": "t" };

export type World = {
  /** A shared per-worker edition ("free" or "wa"), created on first use. Registrations of different journeys land in it. */
  edition(key: "free" | "wa"): Promise<FixtureEdition>;
  /** A brand-new edition with its own capacity (race editions: capacity 1), created on demand and hidden at the end. */
  createEdition(options: { key: string; mode: "FREE" | "EXTERNAL_WHATSAPP"; capacity: number }): Promise<FixtureEdition>;
  staff: {
    get(path: string): Promise<unknown>;
    /** Staff confirmation of a WhatsApp request. `ok: false` carries the server's refusal (status + code), never a body. */
    confirmRequest(requestId: string): Promise<{ ok: boolean; refusal: string | null }>;
    replaceCredential(passId: string, reason: string): Promise<{ ok: boolean; refusal: string | null }>;
  };
};

async function attempt(call: () => Promise<unknown>): Promise<{ ok: boolean; refusal: string | null }> {
  try {
    await call();
    return { ok: true, refusal: null };
  } catch (error) {
    // The script's ApiError message is "METHOD path -> status CODE (reason)": no response body, no secret.
    return { ok: false, refusal: error instanceof Error ? error.message : "unknown" };
  }
}

/**
 * Workers start together and all sign in as the same QA admin: a newer OTP replaces the older one for that account, so a
 * verify can be refused (400) when another worker minted its code in between. Retrying with a fresh code settles it.
 */
async function openSessionWithRetry(script: FixtureScript, env: Record<string, string | undefined>): Promise<FixtureSession> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await script.openFixtureSession(env);
    } catch (error) {
      lastError = error;
      if (error instanceof Error && /refused|missing|invalid QA_ADMIN_EMAIL|ADMIN_ROLE_MISSING/.test(error.message)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1_000 + Math.random() * 3_000));
    }
  }
  throw lastError;
}

async function buildWorld(projectName: string, workerIndex: number): Promise<{ world: World; teardown: () => Promise<void> }> {
  const e2e = e2eEnv();
  const script = await loadFixtureScript();
  // Local dev keys every anonymous rate limit on one subject; the admin sign-in below must not inherit the other workers' budget.
  resetAuthIpBuckets();
  const session = await openSessionWithRetry(script, fixtureEnv(e2e));
  const tag = `${PROJECT_TAG[projectName] ?? "x"}${workerIndex}${Math.random().toString(36).slice(2, 5)}`;
  const created: FixtureEdition[] = [];
  const shared = new Map<string, Promise<FixtureEdition>>();

  const create = async (key: string, mode: "FREE" | "EXTERNAL_WHATSAPP", capacity: number): Promise<FixtureEdition> => {
    const edition = await script.createIsolatedEdition(session, { runId: e2e.runId, key: `${tag}-${key}`, mode, capacity });
    created.push(edition);
    logFixture({ kind: "edition", slug: edition.slug, edition_id: edition.edition_id, mode: edition.mode, capacity });
    return edition;
  };

  const world: World = {
    edition(key) {
      let pending = shared.get(key);
      if (!pending) {
        pending = create(key, key === "free" ? "FREE" : "EXTERNAL_WHATSAPP", 15);
        shared.set(key, pending);
      }
      return pending;
    },
    createEdition: ({ key, mode, capacity }) => create(key, mode, capacity),
    staff: {
      get: async (path) => (await session.api.get(path)).data,
      confirmRequest: (requestId) => attempt(() => session.api.post(`/api/v1/admin/registration-requests/${requestId}/confirm`, {}, `qa-e2e-confirm-${requestId}-${Date.now()}`)),
      replaceCredential: (passId, reason) => attempt(() => session.api.post(`/api/v1/admin/passes/${passId}/replace-credential`, { reason }, `qa-e2e-replace-${passId}-${Date.now()}`)),
    },
  };

  const teardown = async () => {
    if (clean(process.env.E2E_KEEP_EDITIONS) === "1") return;
    for (const edition of created) {
      const hidden = await script.hideIsolatedEdition(session, edition);
      logFixture({ kind: "edition_hidden", slug: edition.slug, edition_id: edition.edition_id, hidden });
    }
  };
  return { world, teardown };
}

// ---------------------------------------------------------------------------------------------------------
// Test object: the shared harness `test` plus the isolated-edition world, evidence screenshots and the axe gate
// ---------------------------------------------------------------------------------------------------------

mkdirSync(`${EVIDENCE_DIR}/screens`, { recursive: true });

// Journeys drive real server round trips (and, locally, first-hit route compiles): 20 s per assertion, like the account specs.
export const expect = baseExpect.configure({ timeout: 20_000 });

export const test = base.extend<{ evidence: (name: string) => Promise<void>; a11y: (target?: Page) => Promise<void> }, { world: World }>({
  world: [
    async ({}, provide, workerInfo) => {
      const blocker = journeyBlocker();
      if (blocker) {
        // Nothing to build: every test skips itself (see the beforeEach hooks) before touching `world`.
        await provide(null as unknown as World);
        return;
      }
      const { world, teardown } = await buildWorld(workerInfo.project.name, workerInfo.workerIndex);
      await provide(world);
      await teardown();
    },
    { scope: "worker", timeout: 300_000 },
  ],
  evidence: async ({ page }, provide, testInfo) => {
    await provide(async (name: string) => {
      await page.screenshot({ path: `${EVIDENCE_DIR}/screens/${testInfo.project.name}--${name}.png`, fullPage: true, animations: "disabled" });
    });
  },
  a11y: async ({ page }, provide) => {
    await provide(async (target: Page = page) => {
      // Scan settled UI only: a dialog or toast mid-transition has partial opacity (false contrast hits).
      await target.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== "running"));
      const { serious } = await scanForSeriousViolations(target);
      expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
    });
  },
});


/** Skip hook: call from each journey file's `test.beforeEach`. */
export function skipWithoutFixtureAdmin(): void {
  const blocker = journeyBlocker();
  test.skip(blocker !== null, blocker ?? "");
}

// ---------------------------------------------------------------------------------------------------------
// People and sessions
// ---------------------------------------------------------------------------------------------------------

export type Buyer = { context: BrowserContext; page: Page; user: AccountUser };

/** A second, independent browser session (own cookies) signed in as a new READY fixture user. */
export async function newBuyer(browser: Browser, baseURL: string | undefined, label: string, person?: Partial<PersonInput>): Promise<Buyer> {
  const context = await browser.newContext({ baseURL });
  await protectBypass(context);
  const page = await context.newPage();
  const user = await createReadyUser(page, label, person);
  return { context, page, user };
}

/** Friendship through the real API (the UI flow is covered by account/people.spec): `from` asks, `to` accepts. */
export async function befriend(from: Page, to: Page, toUser: AccountUser): Promise<void> {
  const request = await from.request.post("/api/v1/friendships", { data: { public_profile_id: toUser.publicProfileId } });
  expect(request.status(), "friend request").toBeLessThan(300);
  const friendshipId = ((await request.json()) as { data: { friendship_id: string } }).data.friendship_id;
  const accept = await to.request.post(`/api/v1/friendships/${friendshipId}/accept`);
  expect(accept.status(), "friend accept").toBeLessThan(300);
}

export function guestPayload(name: string, dateOfBirth: string) {
  return {
    full_name: name,
    date_of_birth: dateOfBirth,
    sex_code: "M" as const,
    phone_e164: "+528110007001",
    emergency_contact_name: "Contacto Sintetico",
    emergency_contact_phone_e164: "+528110007002",
    emergency_contact_relationship: "Amistad",
  };
}

// ---------------------------------------------------------------------------------------------------------
// /inscripcion/[slug] page helpers (selectors verified against components/registration/**)
// ---------------------------------------------------------------------------------------------------------

export const SUBMIT_LABEL = { FREE: "Confirmar inscripción", EXTERNAL_WHATSAPP: "Apartar mis lugares" } as const;

export const continueButton = (page: Page) => page.getByRole("button", { name: "Continuar", exact: true });

export async function openRegistration(page: Page, slug: string): Promise<void> {
  await page.goto(`/inscripcion/${slug}`);
  await expect(page.getByRole("heading", { name: "¿Quién se inscribe?" })).toBeVisible({ timeout: 30_000 });
  await waitForHydration(page);
}

/** Ticks the people (by visible name) and leaves the rest as the server offers them. */
export async function chooseParticipants(page: Page, names: (string | RegExp)[]): Promise<void> {
  for (const name of names) {
    const box = page.getByRole("checkbox", { name });
    if ((await box.getAttribute("aria-checked")) !== "true") await box.click();
    await expect(box).toHaveAttribute("aria-checked", "true");
  }
}

export type DetailsInput = { modality: RegExp; shirt?: string; club?: string; category?: string | RegExp };

/** Details step for ONE participant card (by name) or for every card (`who` null). */
export async function fillDetails(page: Page, who: string | RegExp | null, input: DetailsInput): Promise<void> {
  const all = page.getByTestId("details-card");
  const cards = who === null ? await all.all() : [all.filter({ hasText: who })];
  for (const card of cards) {
    await card.getByRole("radio", { name: input.modality }).click();
    if (input.category) {
      await card.getByRole("combobox", { name: /Categoría/ }).click();
      await page.getByRole("option", { name: input.category }).click();
    }
    if (input.shirt) {
      await card.getByRole("combobox", { name: /Talla de playera/ }).click();
      await page.getByRole("option", { name: input.shirt, exact: true }).click();
    }
    if (input.club) await card.getByLabel(/Club/).fill(input.club);
  }
}

/** Ticks every pending event-document checkbox of one participant's legal card (the buyer's own acts only). */
export async function acceptEventDocuments(page: Page, who: string | RegExp): Promise<number> {
  const card = page.getByTestId("legal-card").filter({ hasText: who });
  const boxes = await card.getByRole("checkbox").all();
  for (const box of boxes) {
    await box.click();
    await expect(box).toHaveAttribute("aria-checked", "true");
  }
  return boxes.length;
}

/**
 * The buyer presses "Copiar enlace" on a person who has to accept in their own account and gets the deep link
 * (`/cuenta/documentos/evento/{slug}`). Reads the clipboard when the browser allowed the copy and the visible fallback text otherwise.
 */
export async function copyAcceptanceLink(page: Page, scope: Locator): Promise<string> {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => undefined);
  await scope.getByRole("button", { name: /Copiar enlace/ }).click();
  const fallback = scope.getByText(/Copia este enlace:/);
  await expect(page.getByText("Enlace copiado").or(fallback).first()).toBeVisible();
  const link = (await fallback.isVisible()) ? ((await fallback.locator("span").textContent()) ?? "") : await page.evaluate(() => navigator.clipboard.readText());
  expect(link, "the copied acceptance link").toMatch(/\/cuenta\/documentos\/evento\/[a-z0-9-]+$/);
  return link;
}

/** Opens the edition documents screen from the deep link the buyer shared (the person is already signed in). */
export async function openEditionDocuments(page: Page, link: string): Promise<void> {
  await page.goto(link);
  await expect(page.getByTestId("edition-documents")).toBeVisible({ timeout: 30_000 });
  await waitForHydration(page);
}

/** Ticks every document of one card on the edition documents screen, then accepts; returns how many documents it held. */
export async function acceptOnEditionScreen(card: Locator): Promise<number> {
  const boxes = await card.getByRole("checkbox").all();
  const accept = card.getByRole("button", { name: "Aceptar documentos" });
  await expect(accept).toBeDisabled();
  for (const box of boxes) {
    await expect(box).toHaveAttribute("aria-checked", "false");
    await box.click();
    await expect(box).toHaveAttribute("aria-checked", "true");
  }
  await expect(accept).toBeEnabled();
  await accept.click();
  return boxes.length;
}

export type RegisterOptions = {
  people?: (string | RegExp)[];
  details: DetailsInput;
  /** Participants whose event documents the buyer ticks at the legal step. */
  accept?: (string | RegExp)[];
  /** Stop on the review step instead of submitting. */
  stopAtReview?: boolean;
};

/** Walks the four steps of the builder; returns the POST /registration-requests response (null when stopped at review). */
export async function registerThroughUi(page: Page, edition: Pick<FixtureEdition, "slug" | "mode">, options: RegisterOptions) {
  await openRegistration(page, edition.slug);
  if (options.people) await chooseParticipants(page, options.people);
  await continueButton(page).click();
  await expect(page.getByRole("heading", { name: "Modalidad y datos" })).toBeVisible();
  await fillDetails(page, null, options.details);
  await continueButton(page).click();
  await expect(page.getByRole("heading", { name: "Documentos legales" })).toBeVisible();
  for (const who of options.accept ?? []) await acceptEventDocuments(page, who);
  await continueButton(page).click();
  await expect(page.getByRole("heading", { name: "Revisa y envía" })).toBeVisible();
  if (options.stopAtReview) return null;
  return submitAndWait(page, edition.mode);
}

export async function submitAndWait(page: Page, mode: FixtureEdition["mode"]) {
  const created = page.waitForResponse((response) => response.url().endsWith("/api/v1/registration-requests") && response.request().method() === "POST");
  await page.getByRole("button", { name: SUBMIT_LABEL[mode] }).click();
  return created;
}

export type RequestData = {
  registration_request_id: string;
  public_reference: string;
  status: string;
  expires_at: string | null;
  server_time: string;
  whatsapp_url: string | null;
  total_snapshot_minor: number;
  participants: { display_name: string | null; legal_acceptance_status: string; registration: { participant_pass_id: string | null; registration_number: string } | null }[];
};

export async function requestData(response: { status(): number; json(): Promise<unknown> }): Promise<RequestData> {
  expect(response.status(), "POST /registration-requests").toBe(201);
  return ((await response.json()) as { data: RequestData }).data;
}

// ---------------------------------------------------------------------------------------------------------
// Sign-in through the UI (session recovery) and small utilities
// ---------------------------------------------------------------------------------------------------------

/**
 * A fresh 6-digit OTP generated server-side for a fixture address. Remote (and loopback rehearsals with the admin pair):
 * the harness' admin-OTP mechanism. Local: the same admin call against the local stack. The email path is not used here:
 * GoTrue sends one OTP email per address per 60 s, and a journey re-signs in the user it just created through the API.
 */
async function freshCode(email: string): Promise<string> {
  if (usesAdminOtp()) return adminOtpFor(email);
  if (!/^[a-z0-9.-]+@example\.(test|com)$/.test(email)) throw new Error("Refusing to generate an OTP for an address outside the example.test/example.com fixture domains");
  const url = clean(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = clean(process.env.SUPABASE_SECRET_KEY);
  if (!url || !key || !isLoopback(url)) throw new Error("Local journeys need the local Supabase stack (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY of the dev env)");
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const link = await client.auth.admin.generateLink({ type: "magiclink", email });
  const code = link.data?.properties?.email_otp;
  if (link.error || !code) throw new Error(`local OTP generation failed: ${link.error?.message ?? "no email_otp"}`);
  return code;
}

/**
 * Email -> OTP -> "Entrar" on an already open /entrar page. The browser answers the app's OTP request itself (no email is
 * sent) and the code is generated server-side (freshCode), then verified through the real /api/v1/auth/verify.
 */
export async function signInThroughUi(page: Page, email: string): Promise<void> {
  await page.route("**/api/v1/auth/otp", (route) =>
    route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ data: { accepted: true } }) }),
  );
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByRole("button", { name: "Enviar código" }).click();
  await expect(page.getByRole("status").filter({ hasText: email })).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Código de 6 dígitos").fill(await freshCode(email));
  await page.getByRole("button", { name: "Entrar" }).click();
}

/** True once React has attached to the page (a click before that is silently lost in a dev server). */
export async function waitForHydration(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const control = document.querySelector("main button, main [role='checkbox'], main a");
    return control !== null && Object.keys(control).some((key) => key.startsWith("__reactProps$"));
  });
}

export async function hasHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
}

/** Tabs forward until the focused control's accessible text matches (keyboard-only journeys). */
export async function tabTo(page: Page, pattern: RegExp, max = 90): Promise<string> {
  const describe = () =>
    page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return "";
      const labelledby = el.getAttribute("aria-labelledby");
      const byId = labelledby ? labelledby.split(" ").map((id) => document.getElementById(id)?.innerText ?? "").join(" ") : "";
      const labels = "labels" in el && el.labels ? Array.from(el.labels as NodeListOf<HTMLLabelElement>).map((label) => label.innerText).join(" ") : "";
      return [el.getAttribute("aria-label"), byId, labels, el.innerText].filter(Boolean).join(" | ").replace(/\s+/g, " ");
    });
  for (let index = 0; index < max; index++) {
    const name = await describe();
    if (pattern.test(name)) return name;
    await page.keyboard.press("Tab");
  }
  throw new Error(`could not Tab to ${pattern} (last focus: ${await describe()})`);
}

// ---------------------------------------------------------------------------------------------------------
// Registration through the real API (setup of journeys whose subject is what happens AFTER the registration)
// ---------------------------------------------------------------------------------------------------------

/** Registers the signed-in buyer for themself from the server's own registration context (first modality, required answers). */
export async function registerSelfViaApi(page: Page, slug: string, modalityIndex = 0): Promise<RequestData> {
  const contextResponse = await page.request.get(`/api/v1/events/${slug}/registration-context`);
  expect(contextResponse.status(), "registration context").toBe(200);
  type Ctx = {
    edition: { edition_id: string };
    modalities: { modality_id: string }[];
    forms: { modality_id: string | null; fields: { field_key: string; field_type: string; required: boolean; options_config: { options?: { value: string }[] } }[] }[];
    candidates: { public_profile_id: string; acceptance: { missing_document_version_ids: string[] }; modalities: { modality_id: string; category_selection_required: boolean; allowed_category_ids: string[] }[] }[];
  };
  const context = ((await contextResponse.json()) as { data: Ctx }).data;
  const modality = context.modalities[modalityIndex];
  const self = context.candidates[0];
  const verdict = self.modalities.find((entry) => entry.modality_id === modality.modality_id)!;
  const responses: Record<string, string | number | boolean> = {};
  for (const form of context.forms) {
    if (form.modality_id !== null && form.modality_id !== modality.modality_id) continue;
    for (const field of form.fields.filter((entry) => entry.required)) {
      responses[field.field_key] = field.field_type === "SELECT" ? field.options_config.options![0].value : field.field_type === "BOOLEAN" ? true : field.field_type === "NUMBER" ? 1 : "x";
    }
  }
  const created = await page.request.post("/api/v1/registration-requests", {
    data: {
      edition_id: context.edition.edition_id,
      participants: [
        {
          kind: "PROFILE",
          public_profile_id: self.public_profile_id,
          modality_id: modality.modality_id,
          ...(verdict.category_selection_required ? { category_id: verdict.allowed_category_ids[0] } : {}),
          responses,
        },
      ],
      legal_acceptances: self.acceptance.missing_document_version_ids.map((id) => ({ participant_index: 0, legal_document_version_id: id })),
    },
    headers: { "Idempotency-Key": `qa-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` },
  });
  return requestData(created);
}
