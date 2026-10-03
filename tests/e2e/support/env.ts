import { randomBytes } from "node:crypto";

/**
 * E2E mode resolution (P2-A). Pure and side-effect free so the harness self-test can exercise it with
 * synthetic inputs; playwright.config.ts and the support helpers call `resolveE2eEnv()` once.
 *
 * LOCAL mode (no E2E_BASE_URL): today's behaviour exactly -- the config starts/reuses the dev server on
 * 127.0.0.1:3100, sign-in goes through Mailpit, fixtures use the local Docker DB.
 *
 * REMOTE mode (E2E_BASE_URL set): no dev server, the Vercel automation-bypass header goes on every
 * same-origin request, traces/videos are off, sessions come from an admin-generated OTP verified
 * through the app's own /api/v1/auth/verify, and anything that needs local SQL or seeded Editions is
 * skipped with a reason. Every variable is optional; none of them is ever written to a file or log.
 *
 * TARGET GUARD (H2P2-06): remote mode is only for staging or the local stack. E2E_BASE_URL must be
 * https://staging.runiismty.com or a loopback origin, and E2E_SUPABASE_URL must be the staging project or a loopback
 * address; anything else (production, a preview of another project, a real mailbox's project) is refused before any
 * request, so an operator mistake cannot create QA users in production. This mirrors scripts/ops/staging-qa-fixtures.mjs
 * (a unit test pins the two constants to it).
 *
 *   E2E_BASE_URL              target origin, e.g. https://staging.runiismty.com
 *   E2E_VERCEL_BYPASS         Vercel Deployment Protection automation-bypass secret (remote only)
 *   E2E_SUPABASE_URL          Supabase project URL of the target (admin OTP)
 *   E2E_SUPABASE_SERVER_KEY   Supabase server (secret) key of the target (admin OTP)
 *   E2E_RUN_ID                run label for fixture emails (default: generated, 3-24 chars [a-z0-9])
 *   E2E_EVENT_SLUG            slug of an OPEN, published QA Edition on the target (event specs)
 *   E2E_FIXTURE_LOG           NDJSON file listing every fixture user created (default under the P2-A evidence dir)
 *   E2E_WORKERS               worker count for remote runs (default 2; auth.verify.ip allows 30 / 10 min)
 */
export type E2eEnv = {
  remote: boolean;
  baseURL: string;
  /** Header map for extraHTTPHeaders, or undefined when no bypass secret was provided. */
  bypassHeaders: Record<string, string> | undefined;
  /** Every header the config adds to same-origin requests (bypass + skip-toolbar); undefined locally. */
  extraHeaders: Record<string, string> | undefined;
  hasBypass: boolean;
  /** Local Docker DB (psql / scripts/db.mjs) is reachable: true for local runs and loopback targets. */
  localDb: boolean;
  /** Admin-OTP sign-in is configured (otherwise Mailpit, local only). */
  adminOtp: { url: string; key: string } | null;
  runId: string;
  eventSlug: string | null;
  fixtureLog: string;
  workers: number | undefined;
};

export const DEFAULT_LOCAL_BASE_URL = "http://127.0.0.1:3100";
/** The only non-loopback targets a remote E2E run may touch (same values as scripts/ops/staging-qa-fixtures.mjs). */
export const STAGING_HOST = "staging.runiismty.com";
export const STAGING_SUPABASE_REF = "brxdgvcfykmsqmhsvgxl";
export const BYPASS_HEADER = "x-vercel-protection-bypass";
/** Documented by Vercel for automated tests: keeps the Preview Toolbar (a vercel.live iframe the app CSP rightly blocks) out of the page. */
export const SKIP_TOOLBAR_HEADER = "x-vercel-skip-toolbar";
const DEFAULT_FIXTURE_LOG_DIR = ".salvaops-agent-evidence/P2-A-e2e-harness-revalidation";

export class E2eConfigError extends Error {}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

function isLoopback(url: URL): boolean {
  return LOOPBACK.has(url.hostname);
}

/** Refuses any E2E_BASE_URL that is neither the staging origin (https, default port, no credentials) nor loopback. */
function assertBaseTarget(url: URL): void {
  if (url.username || url.password) throw new E2eConfigError("E2E_BASE_URL must not carry credentials");
  if (isLoopback(url)) return;
  if (url.protocol !== "https:" || url.hostname !== STAGING_HOST || url.port !== "") {
    throw new E2eConfigError(`refused: E2E_BASE_URL must be https://${STAGING_HOST} or a loopback address`);
  }
}

/** Refuses any E2E_SUPABASE_URL that is neither the staging project nor a loopback address (the local stack). */
function assertSupabaseTarget(url: URL): void {
  if (url.username || url.password) throw new E2eConfigError("E2E_SUPABASE_URL must not carry credentials");
  if (isLoopback(url)) return;
  if (url.protocol !== "https:" || url.hostname !== `${STAGING_SUPABASE_REF}.supabase.co` || url.port !== "") {
    throw new E2eConfigError(`refused: E2E_SUPABASE_URL must be the staging project (${STAGING_SUPABASE_REF}) or a loopback address`);
  }
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function resolveE2eEnv(env: Record<string, string | undefined> = process.env): E2eEnv {
  const rawBase = clean(env.E2E_BASE_URL);
  const remote = rawBase !== undefined;

  let baseURL = DEFAULT_LOCAL_BASE_URL;
  let loopback = true;
  if (rawBase !== undefined) {
    let parsed: URL;
    try {
      parsed = new URL(rawBase);
    } catch {
      throw new E2eConfigError("E2E_BASE_URL is not a valid URL");
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new E2eConfigError("E2E_BASE_URL must be http(s)");
    loopback = LOOPBACK.has(parsed.hostname);
    if (parsed.protocol === "http:" && !loopback) throw new E2eConfigError("E2E_BASE_URL must be https unless it targets loopback");
    assertBaseTarget(parsed);
    baseURL = parsed.origin;
  }

  const bypass = clean(env.E2E_VERCEL_BYPASS);
  if (bypass !== undefined && !remote) throw new E2eConfigError("E2E_VERCEL_BYPASS requires E2E_BASE_URL (remote mode)");

  const supabaseUrl = clean(env.E2E_SUPABASE_URL);
  const serverKey = clean(env.E2E_SUPABASE_SERVER_KEY);
  if ((supabaseUrl === undefined) !== (serverKey === undefined)) {
    throw new E2eConfigError("E2E_SUPABASE_URL and E2E_SUPABASE_SERVER_KEY must be provided together");
  }
  if (supabaseUrl !== undefined) {
    let parsedSupabase: URL;
    try {
      parsedSupabase = new URL(supabaseUrl);
    } catch {
      throw new E2eConfigError("E2E_SUPABASE_URL is not a valid URL");
    }
    assertSupabaseTarget(parsedSupabase);
  }

  const runId = clean(env.E2E_RUN_ID)?.toLowerCase() ?? `${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;
  if (!/^[a-z0-9]{3,24}$/.test(runId)) throw new E2eConfigError("E2E_RUN_ID must be 3-24 chars of [a-z0-9]");

  const eventSlug = clean(env.E2E_EVENT_SLUG) ?? null;
  if (eventSlug !== null && !/^[a-z0-9-]{1,120}$/.test(eventSlug)) throw new E2eConfigError("E2E_EVENT_SLUG is not a valid slug");

  const workersRaw = clean(env.E2E_WORKERS);
  const workers = workersRaw !== undefined ? Number.parseInt(workersRaw, 10) : remote ? 2 : undefined;
  if (workers !== undefined && (!Number.isInteger(workers) || workers < 1 || workers > 16)) throw new E2eConfigError("E2E_WORKERS must be 1-16");

  return {
    remote,
    baseURL,
    bypassHeaders: bypass !== undefined ? { [BYPASS_HEADER]: bypass } : undefined,
    extraHeaders: remote ? { [SKIP_TOOLBAR_HEADER]: "1", ...(bypass !== undefined ? { [BYPASS_HEADER]: bypass } : {}) } : undefined,
    hasBypass: bypass !== undefined,
    localDb: !remote || loopback,
    adminOtp: supabaseUrl !== undefined && serverKey !== undefined ? { url: supabaseUrl, key: serverKey } : null,
    runId,
    eventSlug,
    fixtureLog: clean(env.E2E_FIXTURE_LOG) ?? `${DEFAULT_FIXTURE_LOG_DIR}/fixtures-${runId}.ndjson`,
    workers,
  };
}

/** Presence-only summary, safe to print: never contains a secret or a key value. */
export function describeE2eEnv(e2e: E2eEnv): string {
  const host = new URL(e2e.baseURL).host;
  return [
    `mode=${e2e.remote ? "remote" : "local"}`,
    `target=${host}`,
    `bypass=${e2e.hasBypass ? "set" : "unset"}`,
    `sign-in=${e2e.adminOtp ? "admin-otp" : "mailpit"}`,
    `local-db=${e2e.localDb ? "yes" : "no"}`,
    `event-slug=${e2e.eventSlug ? "set" : "unset"}`,
    `run=${e2e.runId}`,
  ].join(" ");
}

let cached: E2eEnv | null = null;

/** Process-wide resolution. The config publishes E2E_RUN_ID so every worker shares one run id. */
export function e2eEnv(): E2eEnv {
  cached ??= resolveE2eEnv();
  return cached;
}

/** Harness self-tests only: forget the cached resolution so a test can vary process.env. */
export function resetE2eEnvCache(): void {
  cached = null;
}
