import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";
import { protectBypass } from "../support/bypass";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BYPASS_HEADER, describeE2eEnv, E2eConfigError, e2eEnv, resetE2eEnvCache, resolveE2eEnv } from "../support/env";
import { adminOtpFor, fixtureEmailFor, resetAdminClientCache } from "../support/remote-auth";

// Harness self-test (P2-A): proves the local/remote env plumbing without any real secret and without
// touching the app under test. Viewport independent, so it runs once.
test.describe.configure({ mode: "serial" });
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop", "viewport-independent");
});

const NL = String.fromCharCode(10);
const SYNTHETIC_SECRET = "synthetic-bypass-secret-0123456789";

test.describe("env resolution", () => {
  test("no variables: local mode keeps today's behaviour", () => {
    const e2e = resolveE2eEnv({});
    expect(e2e).toMatchObject({ remote: false, baseURL: "http://127.0.0.1:3100", bypassHeaders: undefined, localDb: true, adminOtp: null });
    expect(e2e.workers).toBeUndefined();
  });

  test("remote: base URL, bypass header, admin OTP and fixture pattern come from the environment", () => {
    const e2e = resolveE2eEnv({
      E2E_BASE_URL: "https://staging.example.test/some/path?x=1",
      E2E_VERCEL_BYPASS: SYNTHETIC_SECRET,
      E2E_SUPABASE_URL: "https://project.supabase.example.test",
      E2E_SUPABASE_SERVER_KEY: "synthetic-server-key",
      E2E_RUN_ID: "Run42",
      E2E_EVENT_SLUG: "qa-open-5k",
    });
    expect(e2e).toMatchObject({ remote: true, baseURL: "https://staging.example.test", localDb: false, runId: "run42", eventSlug: "qa-open-5k", workers: 2 });
    expect(e2e.bypassHeaders).toEqual({ [BYPASS_HEADER]: SYNTHETIC_SECRET });
    expect(e2e.adminOtp).toEqual({ url: "https://project.supabase.example.test", key: "synthetic-server-key" });
    expect(e2e.fixtureLog).toContain("fixtures-run42.ndjson");
  });

  test("a loopback target keeps the local DB available (rehearsal of remote mode)", () => {
    expect(resolveE2eEnv({ E2E_BASE_URL: "http://127.0.0.1:3100" })).toMatchObject({ remote: true, localDb: true });
  });

  test("the printable summary never contains a secret", () => {
    const summary = describeE2eEnv(
      resolveE2eEnv({
        E2E_BASE_URL: "https://staging.example.test",
        E2E_VERCEL_BYPASS: SYNTHETIC_SECRET,
        E2E_SUPABASE_URL: "https://project.supabase.example.test",
        E2E_SUPABASE_SERVER_KEY: "synthetic-server-key",
      }),
    );
    expect(summary).toContain("bypass=set");
    expect(summary).toContain("sign-in=admin-otp");
    expect(summary).not.toContain(SYNTHETIC_SECRET);
    expect(summary).not.toContain("synthetic-server-key");
    expect(summary).not.toContain("project.supabase");
  });

  for (const [name, env] of [
    ["bypass without a remote target", { E2E_VERCEL_BYPASS: SYNTHETIC_SECRET }],
    ["plain http to a non-loopback host", { E2E_BASE_URL: "http://staging.example.test" }],
    ["malformed base URL", { E2E_BASE_URL: "not a url" }],
    ["Supabase URL without a key", { E2E_BASE_URL: "https://staging.example.test", E2E_SUPABASE_URL: "https://x.example.test" }],
    ["Supabase key without a URL", { E2E_BASE_URL: "https://staging.example.test", E2E_SUPABASE_SERVER_KEY: "k" }],
    ["unsafe run id", { E2E_RUN_ID: "../etc" }],
    ["unsafe event slug", { E2E_EVENT_SLUG: "Not A Slug" }],
  ] as const) {
    test(`rejects ${name}`, () => {
      expect(() => resolveE2eEnv(env)).toThrow(E2eConfigError);
    });
  }
});

test.describe("bypass header scope", () => {
  type Seen = { host: string; headers: Record<string, string | string[] | undefined> };
  const seen: Seen[] = [];
  const servers: Server[] = [];

  async function listen(html: string): Promise<string> {
    const server = createServer((request, response) => {
      seen.push({ host: request.headers.host ?? "", headers: request.headers });
      response.setHeader("Access-Control-Allow-Origin", "*");
      response.setHeader("Access-Control-Allow-Headers", "*");
      if (request.method === "OPTIONS") return response.writeHead(204).end();
      response.setHeader("Content-Type", request.url?.startsWith("/page") ? "text/html" : "text/plain");
      response.end(html);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    servers.push(server);
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  test.afterAll(async () => {
    await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
  });

  test("the header reaches the target origin (page and API) and never a third-party origin", async ({ browser }) => {
    const third = await listen("third-party");
    const target = await listen(`<!doctype html><title>t</title><script>fetch(${JSON.stringify(`${third}/asset`)}).catch(() => {});</script>`);
    const context = await browser.newContext({ baseURL: target, extraHTTPHeaders: { [BYPASS_HEADER]: SYNTHETIC_SECRET } });
    await protectBypass(context, target, true);
    const page = await context.newPage();
    await page.goto("/page");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(300);
    await context.request.get("/api-probe");

    const targetHost = new URL(target).host;
    const thirdHost = new URL(third).host;
    const toTarget = seen.filter((entry) => entry.host === targetHost);
    const toThird = seen.filter((entry) => entry.host === thirdHost);
    expect(toTarget.length).toBeGreaterThanOrEqual(2);
    for (const entry of toTarget) expect(entry.headers[BYPASS_HEADER]).toBe(SYNTHETIC_SECRET);
    expect(toThird.length).toBeGreaterThanOrEqual(1);
    for (const entry of toThird) expect(entry.headers[BYPASS_HEADER]).toBeUndefined();
    await context.close();
  });

  test("config-level bypass reaches every context, including ones a spec creates by hand (remote runs only)", async ({ browser, request }) => {
    test.skip(!e2eEnv().hasBypass, "only meaningful when E2E_VERCEL_BYPASS is set for the run");
    const target = await listen("ok");
    const before = seen.length;
    const context = await browser.newContext({ baseURL: target });
    await protectBypass(context, target, true);
    await context.request.get("/probe");
    const handMade = seen.slice(before).filter((entry) => entry.host === new URL(target).host);
    expect(handMade.length).toBeGreaterThan(0);
    for (const entry of handMade) expect(entry.headers[BYPASS_HEADER]).toBe(e2eEnv().bypassHeaders?.[BYPASS_HEADER]);
    await context.close();
    // The shared `request` fixture carries it too.
    const viaFixture = seen.length;
    await request.get(`${target}/probe-fixture`);
    expect(seen.slice(viaFixture).every((entry) => entry.headers[BYPASS_HEADER] === e2eEnv().bypassHeaders?.[BYPASS_HEADER])).toBe(true);
  });

  test("control: without the scope guard Playwright would leak the header to the third party", async ({ browser }) => {
    const third = await listen("third-party");
    const target = await listen(`<!doctype html><title>t</title><script>fetch(${JSON.stringify(`${third}/asset`)}).catch(() => {});</script>`);
    const context = await browser.newContext({ baseURL: target, extraHTTPHeaders: { [BYPASS_HEADER]: SYNTHETIC_SECRET } });
    await protectBypass(context, target, false);
    const before = seen.length;
    const page = await context.newPage();
    await page.goto("/page");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(300);
    const toThird = seen.slice(before).filter((entry) => entry.host === new URL(third).host);
    expect(toThird.some((entry) => entry.headers[BYPASS_HEADER] === SYNTHETIC_SECRET)).toBe(true);
    await context.close();
  });
});

test.describe("admin OTP fixture hook (against a stand-in GoTrue admin API)", () => {
  const calls: { method: string; url: string; apikey: string | undefined; body: Record<string, unknown> }[] = [];
  const existing = new Set<string>();
  let server: Server;
  let logFile: string;
  const saved: Record<string, string | undefined> = {};
  const KEYS = ["E2E_SUPABASE_URL", "E2E_SUPABASE_SERVER_KEY", "E2E_FIXTURE_LOG", "E2E_RUN_ID", "E2E_BASE_URL"];

  test.beforeAll(async () => {
    server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        const body = chunks.length ? (JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>) : {};
        calls.push({ method: request.method ?? "", url: request.url ?? "", apikey: request.headers.apikey as string | undefined, body });
        response.setHeader("Content-Type", "application/json");
        const email = String(body.email ?? "");
        if (request.url?.endsWith("/admin/users")) {
          if (existing.has(email)) return response.writeHead(422).end(JSON.stringify({ code: "email_exists", msg: "A user with this email address has already been registered" }));
          existing.add(email);
          return response.writeHead(200).end(JSON.stringify({ id: "11111111-2222-4333-8444-555555555555", email, aud: "authenticated", role: "authenticated" }));
        }
        if (request.url?.endsWith("/admin/generate_link")) {
          return response.writeHead(200).end(
            JSON.stringify({ action_link: "x", email_otp: "123456", hashed_token: "h", redirect_to: "", verification_type: "magiclink", id: "11111111-2222-4333-8444-555555555555", email }),
          );
        }
        response.writeHead(404).end("{}");
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    logFile = join(mkdtempSync(join(tmpdir(), "e2e-fixtures-")), "fixtures.ndjson");
    for (const key of KEYS) saved[key] = process.env[key];
    process.env.E2E_SUPABASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    process.env.E2E_SUPABASE_SERVER_KEY = "synthetic-server-key";
    process.env.E2E_FIXTURE_LOG = logFile;
    process.env.E2E_RUN_ID = "harness1";
    process.env.E2E_BASE_URL = "https://staging.example.test";
    resetE2eEnvCache();
    resetAdminClientCache();
  });

  test.afterAll(async () => {
    for (const key of KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    resetE2eEnvCache();
    resetAdminClientCache();
    await new Promise((resolve) => server.close(resolve));
  });

  test("creates the QA user, returns the admin-generated OTP and records the fixture without any secret", async () => {
    const email = fixtureEmailFor("Perfil");
    expect(email).toMatch(/^qa\.e2e\.harness1-perfil-[0-9a-f]{6}@example\.com$/);
    expect(await adminOtpFor(email)).toBe("123456");

    const create = calls.find((call) => call.url.endsWith("/admin/users"));
    expect(create?.body).toMatchObject({ email, email_confirm: true });
    expect(create?.apikey).toBe("synthetic-server-key");
    expect(calls.find((call) => call.url.endsWith("/admin/generate_link"))?.body).toMatchObject({ type: "magiclink", email });

    const log = readFileSync(logFile, "utf8").trim().split(NL).map((line) => JSON.parse(line) as Record<string, string>);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ run_id: "harness1", target: "staging.example.test", kind: "auth_user", email, created: true });
    expect(log[0].auth_user_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(log)).not.toContain("synthetic-server-key");
  });

  test("is idempotent: an existing fixture user is reused, not re-created or re-logged", async () => {
    const email = fixtureEmailFor("again");
    await adminOtpFor(email);
    await adminOtpFor(email);
    expect(readFileSync(logFile, "utf8").trim().split(NL)).toHaveLength(2);
  });

  test("refuses to mint an OTP for anything outside the qa.e2e.*@example.com pattern", async () => {
    const before = calls.length;
    await expect(adminOtpFor("real.person@gmail.com")).rejects.toThrow(/fixture pattern/);
    await expect(adminOtpFor("qa.e2e.harness1-x@example.org")).rejects.toThrow(/fixture pattern/);
    expect(calls.length).toBe(before);
  });
});
