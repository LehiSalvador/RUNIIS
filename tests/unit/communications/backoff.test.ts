import { describe, expect, it } from "vitest";
import { backoffDelayMs, backoffRetryAt } from "@/lib/server/workers/outbox/backoff";

describe("backoffDelayMs", () => {
  it("grows exponentially with attempt number (with full jitter, random=1 gives the uncapped ceiling)", () => {
    const random = () => 1;
    expect(backoffDelayMs(1, { baseMs: 1000, factor: 2, maxMs: 1_000_000 }, random)).toBe(1000);
    expect(backoffDelayMs(2, { baseMs: 1000, factor: 2, maxMs: 1_000_000 }, random)).toBe(2000);
    expect(backoffDelayMs(3, { baseMs: 1000, factor: 2, maxMs: 1_000_000 }, random)).toBe(4000);
    expect(backoffDelayMs(4, { baseMs: 1000, factor: 2, maxMs: 1_000_000 }, random)).toBe(8000);
  });

  it("caps the delay at maxMs regardless of how large the attempt number grows", () => {
    const random = () => 1;
    expect(backoffDelayMs(20, { baseMs: 1000, factor: 2, maxMs: 60_000 }, random)).toBe(60_000);
  });

  it("full jitter (default) spans the whole [0, cap] range", () => {
    expect(backoffDelayMs(5, { baseMs: 1000, factor: 2, maxMs: 100_000 }, () => 0)).toBe(0);
    expect(backoffDelayMs(5, { baseMs: 1000, factor: 2, maxMs: 100_000 }, () => 1)).toBe(16_000);
  });

  it("never returns a negative delay and treats attempt < 1 as attempt 1", () => {
    expect(backoffDelayMs(0, {}, () => 0)).toBeGreaterThanOrEqual(0);
    expect(backoffDelayMs(-5, {}, () => 0)).toBeGreaterThanOrEqual(0);
  });

  it("backoffRetryAt adds the delay to the given now()", () => {
    const now = () => 1_000_000;
    const at = backoffRetryAt(1, { baseMs: 5000, jitterRatio: 0 }, now);
    expect(at.getTime()).toBe(1_000_000 + 5000);
  });
});
