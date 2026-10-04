import { mkdirSync } from "node:fs";
import type { Page, TestInfo } from "@playwright/test";
import { expect as supportExpect, test as base } from "./support";

// The shared dev server compiles each API route on its first call and is shared with other agents: be patient.
export const expect = supportExpect.configure({ timeout: 45_000 });
export { gotoAndSettle, signInAs } from "./support";

/** Screens for the P3-E1 evidence pack. */
export const EVENTS_EVIDENCE_DIR = ".salvaops-agent-evidence/P3-E1-event-management-readiness/screens";
mkdirSync(EVENTS_EVIDENCE_DIR, { recursive: true });

/** Seeded Event ("RUNIIS Demo Carrera", supabase/seeds) the API-created fixture Editions belong to. */
export const SEED_EVENT_ID = "40000000-0000-4000-8000-000000900001";

export const test = base.extend<{ shot: (name: string) => Promise<void> }>({
  shot: async ({ page }, provide, testInfo: TestInfo) => {
    await provide(async (name: string) => {
      await page.screenshot({ path: `${EVENTS_EVIDENCE_DIR}/${testInfo.project.name}--${name}.png`, fullPage: true, animations: "disabled" });
    });
  },
});

let counter = 0;
/** A slug nobody else (another worker, a previous run) used. */
export function uniqueSlug(prefix: string, projectName: string): string {
  counter += 1;
  const stamp = `${Date.now().toString(36)}${counter}${Math.random().toString(36).slice(2, 5)}`;
  return `${prefix}-${projectName.replace(/^chromium-/, "")}-${stamp}`.toLowerCase();
}

/** A race date comfortably in the future, as YYYY-MM-DD. */
export function futureDate(daysAhead = 90): string {
  const date = new Date(Date.now() + daysAhead * 86_400_000);
  return date.toISOString().slice(0, 10);
}

type Envelope<T> = { data: T };

async function post<T>(page: Page, path: string, body: unknown): Promise<T> {
  const response = await page.request.post(path, { data: body });
  const text = await response.text();
  if (!response.ok()) throw new Error(`${path} -> ${response.status()} ${text.slice(0, 300)}`);
  return (JSON.parse(text) as Envelope<T>).data;
}

export type FixtureEdition = { editionId: string; slug: string; name: string; modalityId: string | null };

/**
 * An Edition created through the staff API (the same commands the UI calls), for tests whose subject is something
 * else than creating it. `configured` adds an active modality and a published description so it is publishable;
 * `published` also publishes it.
 */
export async function createFixtureEdition(
  page: Page,
  projectName: string,
  options: { configured?: boolean; published?: boolean; label?: string } = {},
): Promise<FixtureEdition> {
  const slug = uniqueSlug(options.label ?? "e1", projectName);
  const name = `E1 ${options.label ?? "Fixture"} ${slug.slice(-8)}`;
  const edition = await post<{ edition_id: string }>(page, "/api/v1/admin/editions", {
    event_id: SEED_EVENT_ID,
    slug,
    name,
    registration_mode: "EXTERNAL_WHATSAPP",
    city: "Monterrey",
    state_region: "Nuevo León",
    schedule: { local_date: futureDate(), local_start_time: "06:30" },
  });
  let modalityId: string | null = null;
  if (options.configured || options.published) {
    const modality = await post<{ modality_id: string }>(page, `/api/v1/admin/editions/${edition.edition_id}/modalities`, {
      key: "10k",
      name: "10K",
      official_distance_m: 10000,
      effective_capacity: 100,
    });
    modalityId = modality.modality_id;
    await post(page, `/api/v1/admin/modalities/${modalityId}/prices`, { name: "General", amount_minor: 25000 });
    await post(page, `/api/v1/admin/editions/${edition.edition_id}/content-blocks`, {
      block_type: "RICH_TEXT",
      status: "PUBLISHED",
      payload: { title: "Sobre la carrera", markdown: "Una carrera urbana para toda la familia por las calles del centro." },
    });
  }
  if (options.published) await post(page, `/api/v1/admin/editions/${edition.edition_id}/publish`, {});
  return { editionId: edition.edition_id, slug, name, modalityId };
}

export async function postTransition(page: Page, editionId: string, command: string, body: unknown = {}): Promise<{ status: number; json: unknown }> {
  const response = await page.request.post(`/api/v1/admin/editions/${editionId}/${command}`, { data: body });
  return { status: response.status(), json: await response.json().catch(() => null) };
}

export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "page scrolls horizontally").toBeLessThanOrEqual(1);
}
