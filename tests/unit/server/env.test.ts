import { describe, expect, it } from "vitest";
import { parseServerEnv } from "@/lib/server/env";
import { getPublicEnv } from "@/lib/shared/public-env";

const valid = {
  APP_ENV: "staging",
  APP_BASE_URL: "https://staging.example.test",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54621",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "pk",
  SUPABASE_SECRET_KEY: "super-secret-value-do-not-print",
  PASS_CREDENTIAL_ENCRYPTION_KEY_V1: "k".repeat(32),
  INTERNAL_CRON_SECRET: "c".repeat(32),
};

describe("parseServerEnv", () => {
  it("parses a valid environment and collects versioned pass keys", () => {
    const env = parseServerEnv({ ...valid, PASS_CREDENTIAL_ENCRYPTION_KEY_V2: "z".repeat(40), UNRELATED: "x" });
    expect(env.APP_ENV).toBe("staging");
    expect([...env.passCredentialKeys.keys()].sort()).toEqual([1, 2]);
  });

  it("names invalid variables without echoing any value", () => {
    const attempt = () =>
      parseServerEnv({ ...valid, APP_ENV: "prod-typo-value", SUPABASE_SECRET_KEY: "", INTERNAL_CRON_SECRET: "short-secret-value" });
    expect(attempt).toThrow(/APP_ENV/);
    try {
      attempt();
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain("SUPABASE_SECRET_KEY");
      expect(message).toContain("INTERNAL_CRON_SECRET");
      expect(message).not.toContain("prod-typo-value");
      expect(message).not.toContain("short-secret-value");
    }
  });

  it("rejects a missing V1 key and a weak extra key version", () => {
    const { PASS_CREDENTIAL_ENCRYPTION_KEY_V1: _omitted, ...withoutV1 } = valid;
    expect(() => parseServerEnv(withoutV1)).toThrow(/PASS_CREDENTIAL_ENCRYPTION_KEY_V1/);
    expect(() => parseServerEnv({ ...valid, PASS_CREDENTIAL_ENCRYPTION_KEY_V3: "weak-key-value" })).toThrow(
      /^Invalid server environment: PASS_CREDENTIAL_ENCRYPTION_KEY_V3$/,
    );
  });
});

describe("getPublicEnv", () => {
  it("exposes only NEXT_PUBLIC_* values", () => {
    expect(Object.keys(getPublicEnv()).sort()).toEqual(["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_URL"]);
  });
});
