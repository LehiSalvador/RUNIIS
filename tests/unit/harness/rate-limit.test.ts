import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { VERIFY_RETRIES, verifyWaitMessage, verifyWaitSeconds } from "../../e2e/support/rate-limit";

// auth.verify.ip (30 / 10 min / IP): the UI and API sign-in helpers wait it out with the same budget.
describe("verify 429 back-off", () => {
  test("uses Retry-After, defaults to 60 s, and never waits more than 90 s", () => {
    expect(verifyWaitSeconds("12")).toBe(12);
    expect(verifyWaitSeconds(undefined)).toBe(60);
    expect(verifyWaitSeconds(null)).toBe(60);
    expect(verifyWaitSeconds("not a number")).toBe(60);
    expect(verifyWaitSeconds("0")).toBe(60);
    expect(verifyWaitSeconds("600")).toBe(90);
    expect(VERIFY_RETRIES).toBe(3);
  });

  test("the log line names the channel, wait and attempt and carries nothing else", () => {
    expect(verifyWaitMessage("ui", 45, 2)).toBe("[e2e] auth.verify rate limited (429) on ui sign-in; waiting 45s (retry 2/3)");
  });

  test("both sign-in helpers use it, and the UI helper only retries on non-local targets", () => {
    const read = (file: string) => readFileSync(join(process.cwd(), "tests/e2e/support", file), "utf8");
    for (const file of ["account.ts", "journey.ts"]) {
      const source = read(file);
      expect(source, file).toContain("verifyWaitSeconds(");
      expect(source, file).toContain("VERIFY_RETRIES");
    }
    expect(read("journey.ts")).toMatch(/const waitOut429 = !e2eEnv\(\)\.localDb;/);
  });
});
