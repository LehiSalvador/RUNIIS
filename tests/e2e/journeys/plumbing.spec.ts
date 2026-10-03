import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { resolveE2eEnv } from "../support/env";
import { fixtureEnv, journeyBlocker, loadFixtureScript, LOCAL_ADMIN_EMAIL, NEEDS_FIXTURE_ADMIN } from "../support/journey";

// Journey plumbing self-test (P2-E, P2-AC-17.b): proves, without any real secret and without touching any
// target, that the isolated-edition fixtures are wired to the E2E env, that the script's own target guards
// stay in force, and that nothing can point a journey at the owner-facing qa-p2 editions.
// Viewport independent, so it runs once.
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop", "viewport-independent");
});

// Built at runtime so no secret-looking literal lives in the tree (gitleaks).
const SYNTHETIC_BYPASS = ["synthetic", "bypass", randomBytes(8).toString("hex")].join("-");
const SYNTHETIC_SERVER_KEY = ["synthetic", "server", randomBytes(8).toString("hex")].join("-");
const STAGING_URL = "https://staging.runiismty.com";
const STAGING_SUPABASE = "https://brxdgvcfykmsqmhsvgxl.supabase.co";

const remoteEnv = (extra: Record<string, string> = {}) =>
  resolveE2eEnv({
    E2E_BASE_URL: STAGING_URL,
    E2E_VERCEL_BYPASS: SYNTHETIC_BYPASS,
    E2E_SUPABASE_URL: STAGING_SUPABASE,
    E2E_SUPABASE_SERVER_KEY: SYNTHETIC_SERVER_KEY,
    E2E_RUN_ID: "plumb01",
    ...extra,
  });

test.describe("fixture environment", () => {
  test("staging: the injected variables reach the fixture script and pass its target guard", async () => {
    const script = await loadFixtureScript();
    const env = fixtureEnv(remoteEnv(), { QA_ADMIN_EMAIL: "qa.admin@example.com" });
    expect(env).toMatchObject({ E2E_BASE_URL: STAGING_URL, E2E_SUPABASE_URL: STAGING_SUPABASE, E2E_SUPABASE_SERVER_KEY: SYNTHETIC_SERVER_KEY, E2E_VERCEL_BYPASS: SYNTHETIC_BYPASS, QA_ADMIN_EMAIL: "qa.admin@example.com" });
    expect(env.QA_FIXTURES_LOCAL).toBeUndefined();
    expect(script.resolveConfig(env)).toMatchObject({ local: false, baseUrl: STAGING_URL, adminEmail: "qa.admin@example.com" });
  });

  test("staging: the admin identity comes only from the environment (no default)", () => {
    expect(fixtureEnv(remoteEnv(), {}).QA_ADMIN_EMAIL).toBeUndefined();
    expect(journeyBlocker(remoteEnv(), {})).toBe(NEEDS_FIXTURE_ADMIN);
    expect(journeyBlocker(remoteEnv(), { QA_ADMIN_EMAIL: "qa.admin@example.com" })).toBeNull();
    // Without the Supabase pair there is no admin OTP either: journeys skip instead of failing.
    expect(journeyBlocker(resolveE2eEnv({ E2E_BASE_URL: STAGING_URL }), { QA_ADMIN_EMAIL: "qa.admin@example.com" })).toBe(NEEDS_FIXTURE_ADMIN);
  });

  test("a loopback target is the local stack: seed admin, local-mode flag, no bypass secret forwarded", () => {
    const env = fixtureEnv(resolveE2eEnv({ E2E_BASE_URL: "http://127.0.0.1:3100", E2E_VERCEL_BYPASS: SYNTHETIC_BYPASS }), {
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54621",
      SUPABASE_SECRET_KEY: SYNTHETIC_SERVER_KEY,
    });
    expect(env).toMatchObject({ QA_FIXTURES_LOCAL: "1", QA_ADMIN_EMAIL: LOCAL_ADMIN_EMAIL, NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54621" });
    expect(env.E2E_VERCEL_BYPASS).toBeUndefined();
    expect(journeyBlocker(resolveE2eEnv({ E2E_BASE_URL: "http://127.0.0.1:3100" }), {})).toBeNull();
    expect(journeyBlocker(resolveE2eEnv({}), {})).toBeNull();
  });

  test("the production refusal flags are passed through so the script's guard keeps working", async () => {
    const script = await loadFixtureScript();
    const env = fixtureEnv(remoteEnv(), { QA_ADMIN_EMAIL: "qa.admin@example.com", APP_ENV: "production" });
    expect(() => script.resolveConfig(env)).toThrow(/production/);
  });

  test("a non-staging target is refused by the harness and, independently, by the script, even with every variable present", async () => {
    const production = { E2E_BASE_URL: "https://www.runiismty.com", E2E_SUPABASE_URL: STAGING_SUPABASE, E2E_SUPABASE_SERVER_KEY: SYNTHETIC_SERVER_KEY };
    expect(() => resolveE2eEnv(production)).toThrow(/staging\.runiismty\.com/);
    const script = await loadFixtureScript();
    expect(() => script.resolveConfig({ ...production, QA_ADMIN_EMAIL: "qa.admin@example.com" })).toThrow(/staging\.runiismty\.com/);
  });
});

test.describe("isolation", () => {
  test("every isolated edition is named qa-e2e-<runId>-<key> with its own capacity and the shape of the qa-p2 one", async () => {
    const script = await loadFixtureScript();
    const free = script.isolatedEditionSpec({ runId: "plumb01", key: "d0ab-free", mode: "FREE", capacity: 15 });
    expect(free).toMatchObject({ slug: "qa-e2e-plumb01-d0ab-free", mode: "FREE" });
    expect(free.modalities.map((m) => m.capacity)).toEqual([15, 15]);
    const race = script.isolatedEditionSpec({ runId: "plumb01", key: "d0ab-racewa", mode: "EXTERNAL_WHATSAPP", capacity: 1 });
    expect(race.slug).toBe("qa-e2e-plumb01-d0ab-racewa");
    expect(race.modalities.map((m) => m.capacity)).toEqual([1, 1]);
    expect(race.editionName).toContain("WhatsApp");
  });

  test("the owner-facing QA editions and any real slug are refused before any request", async () => {
    const script = await loadFixtureScript();
    for (const slug of ["qa-p2-gratis", "qa-p2-whatsapp", "demo-libre-5k-10k", "qa-e2e-x", "qa-e2e--free", "qa-e2e-plumb01-"]) {
      expect(() => script.assertIsolatedSlug(slug), slug).toThrow(/qa-e2e-/);
    }
    expect(() => script.assertIsolatedSlug("qa-e2e-plumb01-d0ab-free")).not.toThrow();
    // A hostile run id or key cannot smuggle a qa-p2 slug through the builder.
    expect(() => script.isolatedEditionSpec({ runId: "../x", key: "qa-p2-gratis", mode: "FREE" })).toThrow();
    expect(() => script.isolatedEditionSpec({ runId: "plumb01", key: "free", mode: "FREE", capacity: 0 })).toThrow(/capacity/);
    expect(() => script.isolatedEditionSpec({ runId: "plumb01", key: "free", mode: "PAID" as never })).toThrow(/mode/);
  });

  test("opening the admin session against a refused target fails before any network call", async () => {
    const script = await loadFixtureScript();
    const started = Date.now();
    await expect(script.openFixtureSession({ E2E_BASE_URL: "https://example.com", E2E_SUPABASE_URL: STAGING_SUPABASE, E2E_SUPABASE_SERVER_KEY: SYNTHETIC_SERVER_KEY, QA_ADMIN_EMAIL: "qa.admin@example.com" })).rejects.toThrow(/refused/);
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});
