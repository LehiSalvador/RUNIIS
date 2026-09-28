import { describe, expect, test } from "vitest";
import { createServerClock, formatCountdown, getCountdownState, getRemainingMs } from "@/lib/client/countdown";

describe("getRemainingMs", () => {
  test("returns the difference between expiry and now", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const expiresAt = new Date("2026-01-01T00:00:30.000Z");
    expect(getRemainingMs(expiresAt, now)).toBe(30_000);
  });

  test("clamps to zero once expiry is in the past", () => {
    const now = new Date("2026-01-01T00:01:00.000Z");
    const expiresAt = new Date("2026-01-01T00:00:00.000Z");
    expect(getRemainingMs(expiresAt, now)).toBe(0);
  });

  test("treats an unparseable expiry as expired, never as an endless hold", () => {
    expect(getRemainingMs("not-a-date", new Date())).toBe(0);
    expect(getCountdownState("not-a-date").expired).toBe(true);
  });

  test("accepts an ISO string", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    expect(getRemainingMs("2026-01-01T00:00:10.000Z", now)).toBe(10_000);
  });
});

describe("formatCountdown", () => {
  test("formats under a day as HH:MM:SS", () => {
    expect(formatCountdown(3661_000)).toBe("01:01:01");
  });

  test("formats a day or more as Dd HH:MM", () => {
    expect(formatCountdown(25 * 60 * 60 * 1000 + 90_000)).toBe("1d 01:01");
  });

  test("formats zero as 00:00:00", () => {
    expect(formatCountdown(0)).toBe("00:00:00");
  });
});

describe("getCountdownState", () => {
  test("is not expired while remaining time is positive", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const expiresAt = new Date("2026-01-01T00:10:00.000Z");
    const state = getCountdownState(expiresAt, now);
    expect(state.expired).toBe(false);
    expect(state.formatted).toBe("00:10:00");
  });

  test("flips to expired the instant now >= expires_at, independent of any status field", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const expiresAt = new Date("2025-12-31T23:59:59.000Z");
    const state = getCountdownState(expiresAt, now);
    expect(state.expired).toBe(true);
    expect(state.inFinalWarning).toBe(false);
  });

  test("flags the final 5-minute warning window while still live", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const expiresAt = new Date("2026-01-01T00:04:59.000Z");
    const state = getCountdownState(expiresAt, now);
    expect(state.expired).toBe(false);
    expect(state.inFinalWarning).toBe(true);
  });

  test("does not flag the warning window outside the last 5 minutes", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const expiresAt = new Date("2026-01-01T00:05:01.000Z");
    const state = getCountdownState(expiresAt, now);
    expect(state.inFinalWarning).toBe(false);
  });
});

describe("createServerClock", () => {
  test("applies the measured device-clock skew to every reading", () => {
    // The device clock is 10 minutes ahead of the server.
    const serverNowMs = Date.parse("2026-01-01T00:00:00.000Z");
    const clientNowMs = serverNowMs + 10 * 60 * 1000;
    const clock = createServerClock(new Date(serverNowMs).toISOString(), clientNowMs);
    const appliedSkewMs = clock().getTime() - Date.now();
    expect(Math.abs(appliedSkewMs - (serverNowMs - clientNowMs))).toBeLessThan(50);
  });

  test("falls back to the device clock without a usable server time", () => {
    expect(Math.abs(createServerClock(undefined)().getTime() - Date.now())).toBeLessThan(50);
    expect(Math.abs(createServerClock("garbage")().getTime() - Date.now())).toBeLessThan(50);
  });
});
