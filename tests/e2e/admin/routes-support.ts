import { appendFileSync, mkdirSync } from "node:fs";
import type { Page, TestInfo } from "@playwright/test";
import { scanForSeriousViolations } from "../support/axe";
import { expect as supportExpect, test as base } from "./support";

// The shared dev server compiles each route on its first hit: be patient.
export const expect = supportExpect.configure({ timeout: 45_000 });
export { gotoAndSettle, signInAs } from "./support";
export { createFixtureEdition, expectNoHorizontalScroll } from "./events-support";

/** Screens and axe results for the P3-F evidence pack. */
export const ROUTES_EVIDENCE_DIR = ".salvaops-agent-evidence/P3-F-route-editor";
export const ROUTES_SCREENS_DIR = `${ROUTES_EVIDENCE_DIR}/screens`;
const AXE_LOG = `${ROUTES_EVIDENCE_DIR}/axe-results.ndjson`;
mkdirSync(ROUTES_SCREENS_DIR, { recursive: true });

export const test = base.extend<{ shot: (name: string) => Promise<void>; axe: (label: string) => Promise<void> }>({
  shot: async ({ page }, provide, testInfo: TestInfo) => {
    await provide(async (name: string) => {
      await page.screenshot({ path: `${ROUTES_SCREENS_DIR}/${testInfo.project.name}--${name}.png`, fullPage: true, animations: "disabled" });
    });
  },
  // Scans settled UI (a dialog mid-animation has transient partial opacity), asserts no serious/critical violation and records every scan.
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

/**
 * A synthetic GPX: a track of `points` points running east from (lon0, lat0) over `spanLon` degrees (about 10 km at the default span near
 * Monterrey) with a small north-south wobble, plus optional named waypoints (the server infers their type from the name). Built at run time:
 * no fixture file, no real location data.
 */
export function gpxXml(options: { points?: number; spanLon?: number; lon0?: number; lat0?: number; waypoints?: boolean; name?: string } = {}): string {
  const { points = 400, spanLon = 0.0996, lon0 = -100.35, lat0 = 25.68, waypoints = true, name = "Ruta sintética" } = options;
  const track = Array.from({ length: points }, (_, index) => {
    const t = index / (points - 1);
    const lon = (lon0 + spanLon * t).toFixed(6);
    const lat = (lat0 + 0.004 * Math.sin(t * Math.PI * 4)).toFixed(6);
    return `      <trkpt lat="${lat}" lon="${lon}"></trkpt>`;
  });
  const wpt = waypoints
    ? [
        `  <wpt lat="${lat0.toFixed(6)}" lon="${lon0.toFixed(6)}"><name>Salida</name></wpt>`,
        `  <wpt lat="${lat0.toFixed(6)}" lon="${(lon0 + spanLon).toFixed(6)}"><name>Meta</name></wpt>`,
        `  <wpt lat="${(lat0 + 0.002).toFixed(6)}" lon="${(lon0 + spanLon / 2).toFixed(6)}"><name>Agua km 5</name><desc>Hidratación a mitad de ruta</desc></wpt>`,
      ].join("\n")
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="runiis-e2e" xmlns="http://www.topografix.com/GPX/1/1">\n${wpt}\n  <trk><name>${name}</name><trkseg>\n${track.join("\n")}\n  </trkseg></trk>\n</gpx>\n`;
}

export function gpxUpload(xml: string, name = "ruta-sintetica.gpx") {
  return { name, mimeType: "application/gpx+xml", buffer: Buffer.from(xml, "utf8") };
}

export async function waitMapReady(page: Page): Promise<void> {
  await expect(page.getByTestId("route-editor-map")).toHaveAttribute("data-status", "ready", { timeout: 60_000 });
}

/** Clicks the map canvas at a fraction of its size (0..1). */
export async function clickMap(page: Page, fx: number, fy: number): Promise<void> {
  const canvas = page.locator('[data-testid="route-editor-map"] canvas.maplibregl-canvas');
  await canvas.evaluate((node) => node.scrollIntoView({ block: "center" }));
  const box = await canvas.boundingBox();
  if (!box) throw new Error("the map canvas has no box");
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
  // Two clicks closer than ~300 ms are a double click to MapLibre (zoom) and the second one is not delivered as a click.
  await page.waitForTimeout(450);
}

export async function dragOnMap(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  const canvas = page.locator('[data-testid="route-editor-map"] canvas.maplibregl-canvas');
  await canvas.evaluate((node) => node.scrollIntoView({ block: "center" }));
  const box = await canvas.boundingBox();
  if (!box) throw new Error("the map canvas has no box");
  await page.mouse.move(box.x + box.width * from[0], box.y + box.height * from[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * ((from[0] + to[0]) / 2), box.y + box.height * ((from[1] + to[1]) / 2), { steps: 4 });
  await page.mouse.move(box.x + box.width * to[0], box.y + box.height * to[1], { steps: 4 });
  await page.mouse.up();
}

/** Route editing is a tablet/desktop task; the mobile project checks the read-only behaviour instead. */
export function isWide(projectName: string): boolean {
  return projectName !== "chromium-mobile";
}

type Envelope<T> = { data: T };

export async function apiPost<T>(page: Page, path: string, body: unknown): Promise<T> {
  const response = await page.request.post(path, { data: body, headers: { "idempotency-key": crypto.randomUUID() } });
  const text = await response.text();
  if (!response.ok()) throw new Error(`${path} -> ${response.status()} ${text.slice(0, 300)}`);
  return (JSON.parse(text) as Envelope<T>).data;
}
