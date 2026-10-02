import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/health/route";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("/api/health (AUD-028)", () => {
  it.each(["local", "staging", "production"] as const)("reports the real APP_ENV: %s", async (appEnv) => {
    vi.stubEnv("APP_ENV", appEnv);
    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", environment: appEnv, checks: { app: "ok" } });
  });

  it.each(["", "prod", "Staging"])("never reports staging for an invalid APP_ENV (%j) and does not echo it", async (appEnv) => {
    vi.stubEnv("APP_ENV", appEnv);
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({ status: "error", environment: "unknown", checks: { app: "invalid_app_env" } });
  });

  it("never reports staging for a missing APP_ENV", async () => {
    vi.stubEnv("APP_ENV", undefined as unknown as string);
    const response = await GET();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "error", environment: "unknown", checks: { app: "invalid_app_env" } });
  });

  it("never leaks configuration or secrets", async () => {
    vi.stubEnv("APP_ENV", "production");
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_should-never-appear");
    const text = JSON.stringify(await (await GET()).json());

    expect(text).not.toContain("sb_secret_should-never-appear");
    expect(Object.keys(JSON.parse(text)).sort()).toEqual(["checks", "environment", "status"]);
  });
});
