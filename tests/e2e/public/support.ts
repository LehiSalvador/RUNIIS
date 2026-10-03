import { execFileSync } from "node:child_process";
import type { Page } from "@playwright/test";
import { expect as baseExpect, test as base } from "../support/fixtures";

// Public specs never reach the real OpenFreeMap CDN (local targets only): its style URL is answered
// with a minimal tile-less style, so MapLibre renders the route line and POIs from our own GeoJSON.
export const STUB_MAP_STYLE = {
  version: 8,
  sources: {},
  layers: [{ id: "background", type: "background", paint: { "background-color": "#ECEEE8" } }],
};

export async function stubMapTiles(page: Page, mode: "ok" | "fail" = "ok") {
  await page.context().unroute("https://tiles.openfreemap.org/**");
  await page.context().route("https://tiles.openfreemap.org/**", (route) =>
    mode === "ok"
      ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(STUB_MAP_STYLE) })
      : route.abort("failed"),
  );
}

export const test = base.extend<{ mapTiles: void }>({
  mapTiles: [
    async ({ page }, use) => {
      await stubMapTiles(page, "ok");
      await use();
    },
    { auto: true },
  ],
});

// The first hit on a route compiles it (local dev server) or cold-starts it (remote), and the event
// page's availability and the library's client handlers only settle after hydration: 5 s is too tight.
const expect = baseExpect.configure({ timeout: 15_000 });
export { expect };

/** Seeded Editions (supabase/seeds/20_events.sql). */
export const SEED = {
  open: "demo-libre-5k-10k",
  openPaid: "demo-pago-10k-21k",
  notOpen: "demo-proximamente",
  postponed: "demo-pospuesta",
  canceled: "demo-cancelada",
  finished: "demo-finalizada-2025",
} as const;

/** Lock-guarded local DB helper (scripts/db.mjs); only ever targets the local Docker database. */
export function localSql(sql: string) {
  execFileSync("node", ["scripts/db.mjs", "sql", "-c", sql], { stdio: "pipe", cwd: process.cwd() });
}

export function availabilityBody(global: "AVAILABLE" | "LOW" | "TEMPORARILY_UNAVAILABLE" | "SOLD_OUT") {
  return {
    data: {
      edition_id: "50000000-0000-4000-8000-000000900001",
      registration_state: "OPEN",
      execution_state: "SCHEDULED",
      global_state: global,
      modalities: [],
    },
  };
}
