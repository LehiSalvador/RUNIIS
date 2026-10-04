import { appendFileSync, mkdirSync } from "node:fs";
import type { Page, TestInfo } from "@playwright/test";
import { scanForSeriousViolations } from "../support/axe";
import { expect as supportExpect, test as base } from "./support";

// The shared dev server compiles each route on its first hit and is shared with other agents: be patient.
export const expect = supportExpect.configure({ timeout: 45_000 });
export { gotoAndSettle, signInAs } from "./support";
export { SEED_EVENT_ID, expectNoHorizontalScroll, futureDate, postTransition, uniqueSlug } from "./events-support";
import { SEED_EVENT_ID, futureDate, uniqueSlug } from "./events-support";

/** Screens and axe results for the P3-E2 evidence pack. */
export const CONFIG_EVIDENCE_DIR = ".salvaops-agent-evidence/P3-E2-edition-content-config";
export const CONFIG_SCREENS_DIR = `${CONFIG_EVIDENCE_DIR}/screens`;
const AXE_LOG = `${CONFIG_EVIDENCE_DIR}/axe-results.ndjson`;
mkdirSync(CONFIG_SCREENS_DIR, { recursive: true });

export const test = base.extend<{ shot: (name: string) => Promise<void>; axe: (label: string) => Promise<void> }>({
  shot: async ({ page }, provide, testInfo: TestInfo) => {
    await provide(async (name: string) => {
      await page.screenshot({ path: `${CONFIG_SCREENS_DIR}/${testInfo.project.name}--${name}.png`, fullPage: true, animations: "disabled" });
    });
  },
  // Scans settled UI (a dialog mid-animation has transient partial opacity), asserts no serious/critical violation and records the
  // outcome of every scan so the evidence pack can be summarised from facts, not from memory.
  axe: async ({ page }, provide, testInfo: TestInfo) => {
    await provide(async (label: string) => {
      await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== "running"));
      const { results, serious } = await scanForSeriousViolations(page);
      const count = (impact: string) => results.violations.filter((violation) => violation.impact === impact).length;
      appendFileSync(
        AXE_LOG,
        `${JSON.stringify({ project: testInfo.project.name, label, critical: count("critical"), serious: count("serious"), moderate: count("moderate"), minor: count("minor"), rules: results.passes.length })}\n`,
      );
      expect(serious.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`)).toEqual([]);
    });
  },
});

type Envelope<T> = { data: T };

async function post<T>(page: Page, path: string, body: unknown, headers?: Record<string, string>): Promise<T> {
  const response = await page.request.post(path, { data: body, headers });
  const text = await response.text();
  if (!response.ok()) throw new Error(`${path} -> ${response.status()} ${text.slice(0, 300)}`);
  return (JSON.parse(text) as Envelope<T>).data;
}

export type ConfigFixture = { editionId: string; slug: string; name: string; modalityId: string };

/**
 * A draft Edition made through the staff API with ONLY what the screens under test do not configure: one active modality with a price
 * and capacity (the modality screens are P3-E1's). No description, no form, no WhatsApp number, no location, no agenda: those are the
 * subject of the P3-E2 journey.
 */
export async function createEditionToConfigure(page: Page, projectName: string, label: string, options: { raceDaysAhead?: number } = {}): Promise<ConfigFixture> {
  const slug = uniqueSlug(label, projectName);
  const name = `E2 ${label} ${slug.slice(-8)}`;
  const edition = await post<{ edition_id: string }>(page, "/api/v1/admin/editions", {
    event_id: SEED_EVENT_ID,
    slug,
    name,
    registration_mode: "EXTERNAL_WHATSAPP",
    city: "Monterrey",
    state_region: "Nuevo León",
    schedule: { local_date: futureDate(options.raceDaysAhead ?? 90), local_start_time: "06:30" },
  });
  const modality = await post<{ modality_id: string }>(page, `/api/v1/admin/editions/${edition.edition_id}/modalities`, {
    key: "10k",
    name: "10K",
    official_distance_m: 10000,
    effective_capacity: 100,
  });
  await post(page, `/api/v1/admin/modalities/${modality.modality_id}/prices`, { name: "General", amount_minor: 25000 });
  return { editionId: edition.edition_id, slug, name, modalityId: modality.modality_id };
}

const REQUIRED_LEGAL = ["TERMS_OF_SERVICE", "PRIVACY_NOTICE", "SPORT_WAIVER", "MINOR_TERMS"] as const;

type LegalDocument = { legal_document_id: string; document_type: string; status: string; edition_id: string | null; current_version: unknown };

/**
 * Registration can only open with the platform legal documents published (a server rule). Legal documents are GLOBAL and already
 * published on a seeded local stack that has run a registration; this publishes only what is missing, as an ADMIN, through the
 * same admin API. Returns the document types it had to publish (usually none).
 */
export async function ensureLegalPublished(page: Page): Promise<string[]> {
  const response = await page.request.get("/api/v1/admin/legal");
  if (!response.ok()) throw new Error(`/api/v1/admin/legal -> ${response.status()}`);
  const documents = ((await response.json()) as Envelope<LegalDocument[]>).data;
  const published: string[] = [];
  for (const type of REQUIRED_LEGAL) {
    if (documents.some((doc) => doc.document_type === type && doc.status === "ACTIVE" && doc.edition_id === null && doc.current_version !== null)) continue;
    const existing = documents.find((doc) => doc.document_type === type && doc.status === "ACTIVE" && doc.edition_id === null);
    const documentId = existing?.legal_document_id ?? (await post<{ legal_document_id: string }>(page, "/api/v1/admin/legal", { document_type: type })).legal_document_id;
    const version = await post<{ legal_document_version_id: string }>(page, `/api/v1/admin/legal/${documentId}/versions`, {
      content_markdown: `Documento de prueba local (${type}). Sin valor legal.`,
    });
    await post(page, `/api/v1/admin/legal/versions/${version.legal_document_version_id}/publish`, {});
    published.push(type);
  }
  return published;
}

export async function createEventWithoutEditions(page: Page, label: string): Promise<{ eventId: string; name: string; key: string }> {
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const name = `E2 Evento ${label} ${stamp}`;
  const key = `e2-evento-${label}-${stamp}`.toLowerCase();
  const created = await post<{ event_id: string }>(page, "/api/v1/admin/events", { event_type_key: "TRAIL", name, canonical_key: key }, { "idempotency-key": crypto.randomUUID() });
  return { eventId: created.event_id, name, key };
}
