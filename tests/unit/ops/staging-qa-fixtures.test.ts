import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

// The script is plain ESM (run with `node`); tsconfig has allowJs=false, so it is loaded dynamically and typed here.
type Env = Record<string, string | undefined>;
type FixtureSpec = {
  slug: string;
  mode: "FREE" | "EXTERNAL_WHATSAPP";
  eventName: string;
  editionName: string;
  whatsapp?: string;
  modalities: { key: string; capacity: number; price: number }[];
  forms: { modality: string | null; fields: { field_key: string; required: boolean }[] }[];
};
const script = (await import(/* @vite-ignore */ pathToFileURL(`${process.cwd()}/scripts/ops/staging-qa-fixtures.mjs`).href)) as {
  STAGING_HOST: string;
  STAGING_SUPABASE_REF: string;
  FixtureError: new (message?: string) => Error;
  resolveConfig: (env: Env, argv?: string[]) => { local: boolean; mode: string; baseUrl: string; supabaseUrl: string; bypass?: string; whatsapp: string };
  maskEmail: (email: string) => string;
  fixtureSpecs: (whatsapp: string) => FixtureSpec[];
};
const { FixtureError, STAGING_HOST, STAGING_SUPABASE_REF, fixtureSpecs, maskEmail, resolveConfig } = script;

// P2-AC-16: the staging fixture script is env-only and refuses any target that is not the staging project. These
// tests exercise the pure guard (no network, no secrets): synthetic values only.

const staging = {
  E2E_BASE_URL: `https://${STAGING_HOST}`,
  E2E_SUPABASE_URL: `https://${STAGING_SUPABASE_REF}.supabase.co`,
  E2E_SUPABASE_SERVER_KEY: "synthetic-server-key",
  E2E_VERCEL_BYPASS: "synthetic-bypass",
  QA_ADMIN_EMAIL: "qa-admin@example.test",
};
const local = {
  QA_FIXTURES_LOCAL: "1",
  E2E_BASE_URL: "http://127.0.0.1:3100",
  E2E_SUPABASE_URL: "http://127.0.0.1:54621",
  E2E_SUPABASE_SERVER_KEY: "synthetic-server-key",
  QA_ADMIN_EMAIL: "qa-admin@example.test",
};

describe("staging-qa-fixtures target guard", () => {
  it("accepts exactly the staging app host and the staging Supabase project", () => {
    const cfg = resolveConfig(staging);
    expect(cfg).toMatchObject({ local: false, mode: "converge", baseUrl: `https://${STAGING_HOST}`, bypass: "synthetic-bypass" });
  });

  it("refuses production hosts, other Supabase projects, http and look-alike hosts", () => {
    for (const base of ["https://runiismty.com", "https://www.runiismty.com", `https://${STAGING_HOST}.evil.example`, `http://${STAGING_HOST}`, "https://staging.runiismty.com.attacker.test"]) {
      expect(() => resolveConfig({ ...staging, E2E_BASE_URL: base }), base).toThrow(FixtureError);
    }
    for (const supabase of ["https://abcdefghijklmnopqrst.supabase.co", `https://${STAGING_SUPABASE_REF}.supabase.co.evil.example`, `http://${STAGING_SUPABASE_REF}.supabase.co`, "http://127.0.0.1:54621"]) {
      expect(() => resolveConfig({ ...staging, E2E_SUPABASE_URL: supabase }), supabase).toThrow(FixtureError);
    }
  });

  it("refuses an environment marked as production, whatever the target", () => {
    for (const marker of [{ APP_ENV: "production" }, { VERCEL_ENV: "production" }, { ALLOW_PRODUCTION_MUTATIONS: "true" }]) {
      expect(() => resolveConfig({ ...staging, ...marker })).toThrow(/production/);
      expect(() => resolveConfig({ ...local, ...marker })).toThrow(/production/);
    }
  });

  it("requires every input from the environment (nothing is defaulted to a real target)", () => {
    for (const missing of ["E2E_BASE_URL", "E2E_SUPABASE_URL", "E2E_SUPABASE_SERVER_KEY", "QA_ADMIN_EMAIL"] as const) {
      const env: Env = { ...staging };
      delete env[missing];
      expect(() => resolveConfig(env), missing).toThrow(FixtureError);
    }
    expect(() => resolveConfig({ ...staging, QA_ADMIN_EMAIL: "not-an-email" })).toThrow(FixtureError);
  });

  it("local dry run needs the explicit flag and loopback on both targets, and never carries the Vercel bypass", () => {
    expect(resolveConfig(local)).toMatchObject({ local: true, baseUrl: "http://127.0.0.1:3100" });
    expect(() => resolveConfig({ ...local, E2E_BASE_URL: "http://127.0.0.1:3100", QA_FIXTURES_LOCAL: undefined })).toThrow(FixtureError);
    expect(() => resolveConfig({ ...local, E2E_BASE_URL: `https://${STAGING_HOST}` })).toThrow(FixtureError);
    expect(() => resolveConfig({ ...local, E2E_SUPABASE_URL: `https://${STAGING_SUPABASE_REF}.supabase.co` })).toThrow(FixtureError);
    expect(() => resolveConfig({ ...local, E2E_SUPABASE_URL: "http://127.0.0.1:54322" })).toThrow(FixtureError);
    expect(() => resolveConfig({ ...local, E2E_VERCEL_BYPASS: "x" })).toThrow(FixtureError);
  });

  it("falls back to the bootstrap-admin variable names for the Supabase pair", () => {
    const cfg = resolveConfig({ ...local, E2E_SUPABASE_URL: undefined, E2E_SUPABASE_SERVER_KEY: undefined, NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54621", SUPABASE_SECRET_KEY: "k" });
    expect(cfg.supabaseUrl).toBe("http://127.0.0.1:54621");
  });

  it("selects the mode from the flags and validates the fake WhatsApp number", () => {
    expect(resolveConfig(staging, ["--plan"]).mode).toBe("plan");
    expect(resolveConfig(staging, ["--prepare-admin"]).mode).toBe("prepare-admin");
    expect(() => resolveConfig({ ...staging, QA_WHATSAPP_E164: "5255" })).toThrow(FixtureError);
    expect(resolveConfig({ ...staging, QA_WHATSAPP_E164: "+525555550123" }).whatsapp).toBe("+525555550123");
  });

  it("masks the admin email in anything it prints", () => {
    expect(maskEmail("lehi123salvador@gmail.com")).toBe("le***@gmail.com");
  });

  it("the fixture set covers a FREE and a WhatsApp edition, labelled QA, small capacities, forms and a required field", () => {
    const specs = fixtureSpecs("+525555550100");
    expect(specs.map((s) => s.mode).sort()).toEqual(["EXTERNAL_WHATSAPP", "FREE"]);
    for (const spec of specs) {
      expect(spec.slug).toMatch(/^qa-p2-/);
      expect(spec.eventName).toContain("QA");
      expect(spec.editionName).toContain("QA");
      expect(spec.modalities.length).toBeGreaterThanOrEqual(2);
      expect(Math.min(...spec.modalities.map((m) => m.capacity))).toBeLessThanOrEqual(2); // exercises the last slot
      expect(spec.forms.some((f) => f.modality === null && f.fields.some((field) => field.required))).toBe(true);
    }
    expect(specs.find((s) => s.mode === "EXTERNAL_WHATSAPP")!.whatsapp).toBe("+525555550100");
    expect(specs.find((s) => s.mode === "FREE")!.modalities.every((m) => m.price === 0)).toBe(true);
  });
});
