import { mkdirSync } from "node:fs";
import type { Page, TestInfo } from "@playwright/test";
import { scanForSeriousViolations } from "../support/axe";
import { expect as baseExpect, test as base } from "../support/fixtures";

// The shared dev server compiles routes on first hit and runs real auth/DB round trips.
export const expect = baseExpect.configure({ timeout: 20_000 });

export const EVIDENCE_DIR = ".salvaops-agent-evidence/F2-account/screens";
mkdirSync(EVIDENCE_DIR, { recursive: true });

/** Account specs drive the real dev server (first compile of a route can take a while). */
export const test = base.extend<{ evidence: (name: string) => Promise<void>; a11y: () => Promise<void> }>({
  evidence: async ({ page }, provide, testInfo: TestInfo) => {
    await provide(async (name: string) => {
      await page.screenshot({ path: `${EVIDENCE_DIR}/${testInfo.project.name}--${name}.png`, fullPage: true, animations: "disabled" });
    });
  },
  a11y: async ({ page }, provide) => {
    await provide(async () => {
      // Scan settled UI only: a dialog mid fade-in/out has transient partial opacity (false contrast hits).
      await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== "running"));
      const { serious } = await scanForSeriousViolations(page);
      expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
    });
  },
});


export async function gotoAndSettle(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
}

/**
 * Console errors minus the browser's own "Failed to load resource" line for API statuses a test
 * provoked on purpose (e.g. a wrong OTP -> 400). Anything else still fails the test.
 */
export function unexpectedConsoleErrors(errors: string[], provokedStatuses: number[] = []): string[] {
  return errors.filter((text) => !provokedStatuses.some((status) => text.includes(`status of ${status} `)));
}
