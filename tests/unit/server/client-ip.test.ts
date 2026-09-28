import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerEnv: vi.fn(() => ({ APP_ENV: "local" as string })),
  logEvent: vi.fn(),
}));

vi.mock("@/lib/server/env", () => ({ getServerEnv: mocks.getServerEnv }));
vi.mock("@/lib/server/log", () => ({ logEvent: mocks.logEvent }));

const { getClientIp } = await import("@/lib/server/http/client-ip");

const ORIGIN = "http://localhost:3000";
const HEADER = "x-nf-client-connection-ip";

function request(headers: Record<string, string> = {}) {
  return new NextRequest(`${ORIGIN}/x`, { headers });
}

beforeEach(() => {
  mocks.getServerEnv.mockReturnValue({ APP_ENV: "local" });
  mocks.logEvent.mockClear();
});

describe("getClientIp (F4)", () => {
  it("trusts a syntactically valid IPv4 header value", () => {
    expect(getClientIp(request({ [HEADER]: "203.0.113.9" }))).toBe("203.0.113.9");
  });

  it("trusts a syntactically valid IPv6 header value", () => {
    expect(getClientIp(request({ [HEADER]: "2001:db8::1" }))).toBe("2001:db8::1");
  });

  it("never trusts a spoofed, non-IP header value -- it does not get its own fresh bucket", () => {
    mocks.getServerEnv.mockReturnValue({ APP_ENV: "production" });
    expect(getClientIp(request({ [HEADER]: "attacker-rotated-0001" }))).toBe("unknown");
  });

  it("falls back to local-dev only in local env when the header is missing", () => {
    mocks.getServerEnv.mockReturnValue({ APP_ENV: "local" });
    expect(getClientIp(request())).toBe("local-dev");
  });

  it("F4: a missing header outside local env shares the strict 'unknown' bucket, never local-dev", () => {
    mocks.getServerEnv.mockReturnValue({ APP_ENV: "production" });
    expect(getClientIp(request())).toBe("unknown");
    mocks.getServerEnv.mockReturnValue({ APP_ENV: "staging" });
    expect(getClientIp(request())).toBe("unknown");
  });

  it("logs client_ip_unavailable when the header is missing/invalid outside local", () => {
    mocks.getServerEnv.mockReturnValue({ APP_ENV: "production" });
    getClientIp(request());
    expect(mocks.logEvent).toHaveBeenCalledWith("warn", "client_ip_unavailable", { app_env: "production" });
  });

  it("does not log in local dev", () => {
    mocks.getServerEnv.mockReturnValue({ APP_ENV: "local" });
    getClientIp(request());
    expect(mocks.logEvent).not.toHaveBeenCalled();
  });
});
