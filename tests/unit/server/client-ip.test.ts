import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerEnv: vi.fn(() => ({ APP_ENV: "local" as string })),
  logEvent: vi.fn(),
}));

vi.mock("@/lib/server/env", () => ({ getServerEnv: mocks.getServerEnv }));
vi.mock("@/lib/server/log", () => ({ logEvent: mocks.logEvent }));

const { getClientIp } = await import("@/lib/server/http/client-ip");

const ORIGIN = "http://localhost:3000";
const NETLIFY = "x-nf-client-connection-ip";
const VERCEL_FORWARDED = "x-vercel-forwarded-for";
const REAL_IP = "x-real-ip";
const FORWARDED_FOR = "x-forwarded-for";

function request(headers: Record<string, string> = {}) {
  return new NextRequest(`${ORIGIN}/x`, { headers });
}

beforeEach(() => {
  mocks.getServerEnv.mockReturnValue({ APP_ENV: "local" });
  mocks.logEvent.mockClear();
  vi.stubEnv("VERCEL", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getClientIp on Netlify / local (no VERCEL env) (F4)", () => {
  it("trusts a syntactically valid IPv4 header value", () => {
    expect(getClientIp(request({ [NETLIFY]: "203.0.113.9" }))).toBe("203.0.113.9");
  });

  it("trusts a syntactically valid IPv6 header value", () => {
    expect(getClientIp(request({ [NETLIFY]: "2001:db8::1" }))).toBe("2001:db8::1");
  });

  it("never trusts a spoofed, non-IP header value -- it does not get its own fresh bucket", () => {
    mocks.getServerEnv.mockReturnValue({ APP_ENV: "production" });
    expect(getClientIp(request({ [NETLIFY]: "attacker-rotated-0001" }))).toBe("unknown");
  });

  it("ignores client-suppliable forwarding headers: only Netlify's edge header is an authority here", () => {
    mocks.getServerEnv.mockReturnValue({ APP_ENV: "production" });
    const spoofed = request({ [FORWARDED_FOR]: "198.51.100.7", [REAL_IP]: "198.51.100.8", [VERCEL_FORWARDED]: "198.51.100.9" });
    expect(getClientIp(spoofed)).toBe("unknown");
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

describe("getClientIp on Vercel (VERCEL env set) (AUD-004)", () => {
  beforeEach(() => {
    vi.stubEnv("VERCEL", "1");
    mocks.getServerEnv.mockReturnValue({ APP_ENV: "production" });
  });

  it("trusts x-vercel-forwarded-for (IPv4 and IPv6)", () => {
    expect(getClientIp(request({ [VERCEL_FORWARDED]: "203.0.113.9" }))).toBe("203.0.113.9");
    expect(getClientIp(request({ [VERCEL_FORWARDED]: "2001:db8::1" }))).toBe("2001:db8::1");
  });

  it("prefers x-vercel-forwarded-for, then x-real-ip, then x-forwarded-for", () => {
    const all = { [VERCEL_FORWARDED]: "203.0.113.1", [REAL_IP]: "203.0.113.2", [FORWARDED_FOR]: "203.0.113.3" };
    expect(getClientIp(request(all))).toBe("203.0.113.1");
    expect(getClientIp(request({ [REAL_IP]: "203.0.113.2", [FORWARDED_FOR]: "203.0.113.3" }))).toBe("203.0.113.2");
    expect(getClientIp(request({ [FORWARDED_FOR]: "203.0.113.3" }))).toBe("203.0.113.3");
  });

  it("ignores the Netlify header: Vercel does not strip it, so a client could set it to rotate buckets", () => {
    expect(getClientIp(request({ [NETLIFY]: "203.0.113.50" }))).toBe("unknown");
    expect(getClientIp(request({ [NETLIFY]: "203.0.113.50", [VERCEL_FORWARDED]: "203.0.113.9" }))).toBe("203.0.113.9");
  });

  it("garbage values and comma-separated chains are not trusted and share the 'unknown' bucket", () => {
    expect(getClientIp(request({ [VERCEL_FORWARDED]: "attacker-rotated-0001" }))).toBe("unknown");
    expect(getClientIp(request({ [FORWARDED_FOR]: "198.51.100.7, 203.0.113.9" }))).toBe("unknown");
    expect(getClientIp(request({ [REAL_IP]: "" }))).toBe("unknown");
    expect(mocks.logEvent).toHaveBeenCalledWith("warn", "client_ip_unavailable", { app_env: "production" });
  });

  it("a missing header outside local env is 'unknown'; local env keeps the local-dev subject (vercel dev)", () => {
    expect(getClientIp(request())).toBe("unknown");
    mocks.getServerEnv.mockReturnValue({ APP_ENV: "local" });
    expect(getClientIp(request())).toBe("local-dev");
  });
});
