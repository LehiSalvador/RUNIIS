import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

/** Serious/critical-only view of an axe scan, matching the T15 gate ("axe no serious/critical
 * violations"); moderate/minor findings are still in the raw `results` for manual review. */
export async function scanForSeriousViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  return { results, serious };
}
