import { pathToFileURL } from "node:url";
import { describe, expect, test } from "vitest";
import { E2eConfigError, STAGING_HOST, STAGING_SUPABASE_REF, resolveE2eEnv } from "../../e2e/support/env";

// H2P2-06: remote E2E mode only accepts the staging origin / project or loopback. The guard lives in the
// harness' env resolution (so every spec, helper and journey passes through it), not only in the fixture script.
const script = (await import(/* @vite-ignore */ pathToFileURL(`${process.cwd()}/scripts/ops/staging-qa-fixtures.mjs`).href)) as {
  STAGING_HOST: string;
  STAGING_SUPABASE_REF: string;
};

const STAGING_URL = `https://${STAGING_HOST}`;
const STAGING_SUPABASE_URL = `https://${STAGING_SUPABASE_REF}.supabase.co`;
const KEY = "synthetic-server-key-for-unit-tests";

describe("E2E target guard (H2P2-06)", () => {
  test("the allow-list is the same staging host and project the fixture script enforces", () => {
    expect(STAGING_HOST).toBe(script.STAGING_HOST);
    expect(STAGING_SUPABASE_REF).toBe(script.STAGING_SUPABASE_REF);
  });

  test("local mode and every loopback origin stay accepted", () => {
    expect(resolveE2eEnv({}).remote).toBe(false);
    for (const base of ["http://127.0.0.1:3100", "http://localhost:3102", "http://[::1]:3100", "https://127.0.0.1:3100"]) {
      expect(resolveE2eEnv({ E2E_BASE_URL: base }), base).toMatchObject({ remote: true, localDb: true });
    }
  });

  test("staging is accepted, with or without a path, and the server pair for the staging project or the local stack", () => {
    expect(resolveE2eEnv({ E2E_BASE_URL: `${STAGING_URL}/some/path?x=1` }).baseURL).toBe(STAGING_URL);
    expect(resolveE2eEnv({ E2E_BASE_URL: STAGING_URL, E2E_SUPABASE_URL: STAGING_SUPABASE_URL, E2E_SUPABASE_SERVER_KEY: KEY }).adminOtp).toEqual({ url: STAGING_SUPABASE_URL, key: KEY });
    expect(resolveE2eEnv({ E2E_BASE_URL: "http://127.0.0.1:3100", E2E_SUPABASE_URL: "http://127.0.0.1:54621", E2E_SUPABASE_SERVER_KEY: KEY }).adminOtp?.url).toBe("http://127.0.0.1:54621");
    expect(resolveE2eEnv({ E2E_SUPABASE_URL: "http://localhost:54621", E2E_SUPABASE_SERVER_KEY: KEY }).remote).toBe(false);
  });

  for (const [name, base] of [
    ["production", "https://www.runiismty.com"],
    ["the apex of production", "https://runiismty.com"],
    ["a Vercel preview of the project", "https://runiis-web-git-staging-team.vercel.app"],
    ["an unrelated host", "https://example.com"],
    ["a look-alike prefix", "https://staging.runiismty.com.evil.example"],
    ["a look-alike suffix", "https://evilstaging.runiismty.com"],
    ["a sibling subdomain", "https://app.staging.runiismty.com"],
    ["staging on another port", "https://staging.runiismty.com:8443"],
    ["staging with credentials", "https://user:pass@staging.runiismty.com"],
    ["plain http to staging", "http://staging.runiismty.com"],
    ["a private network address", "http://192.168.1.20:3100"],
    ["a loopback look-alike", "http://127.0.0.1.evil.example"],
  ] as const) {
    test(`refuses E2E_BASE_URL on ${name}`, () => {
      expect(() => resolveE2eEnv({ E2E_BASE_URL: base })).toThrow(E2eConfigError);
    });
  }

  for (const [name, supabase] of [
    ["another Supabase project", "https://abcdefghijklmnopqrst.supabase.co"],
    ["a look-alike of the staging project", `https://${STAGING_SUPABASE_REF}.supabase.co.evil.example`],
    ["the staging ref as a subdomain", `https://x.${STAGING_SUPABASE_REF}.supabase.co`],
    ["plain http to the staging project", `http://${STAGING_SUPABASE_REF}.supabase.co`],
    ["the staging project on another port", `https://${STAGING_SUPABASE_REF}.supabase.co:8443`],
    ["credentials in the URL", `https://user:pass@${STAGING_SUPABASE_REF}.supabase.co`],
    ["an unrelated host", "https://auth.example.com"],
  ] as const) {
    test(`refuses E2E_SUPABASE_URL on ${name}, even against the staging app`, () => {
      expect(() => resolveE2eEnv({ E2E_BASE_URL: STAGING_URL, E2E_SUPABASE_URL: supabase, E2E_SUPABASE_SERVER_KEY: KEY })).toThrow(E2eConfigError);
    });
  }

  test("a production Supabase pair is refused even when the app target is local", () => {
    expect(() => resolveE2eEnv({ E2E_BASE_URL: "http://127.0.0.1:3100", E2E_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co", E2E_SUPABASE_SERVER_KEY: KEY })).toThrow(/staging project/);
  });

  test("the refusal names the allowed target and never echoes a key or the offending credentials", () => {
    let message = "";
    try {
      resolveE2eEnv({ E2E_BASE_URL: STAGING_URL, E2E_SUPABASE_URL: "https://user:hunter2@abcdefghijklmnopqrst.supabase.co", E2E_SUPABASE_SERVER_KEY: KEY });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/credentials|staging project/);
    expect(message).not.toContain(KEY);
    expect(message).not.toContain("hunter2");
  });
});
