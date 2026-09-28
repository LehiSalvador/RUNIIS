import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

let homeData: () => Promise<unknown> = async () => null;
vi.mock("@/app/(public)/_lib/data", () => ({ cachedHomeData: () => homeData() }));

const card = {
  edition_id: "50000000-0000-4000-8000-000000900001",
  slug: "demo-libre-5k-10k",
  name: "Carrera Sintética 5K/10K",
  city: "Monterrey",
  state_region: "NL",
  country_code: "MX",
  sport_date: "2026-11-27",
  registration_state: "OPEN",
  execution_state: "SCHEDULED",
  registration_mode: "FREE",
  availability: { edition_id: "50000000-0000-4000-8000-000000900001", registration_state: "OPEN", execution_state: "SCHEDULED", global_state: "AVAILABLE", modalities: [] },
  modality_summary: { count: 2, min_distance_m: 5000, max_distance_m: 10000, distance_varies: true, min_amount_minor: 0, max_amount_minor: 0, currency: "MXN", price_varies: false, price_pending: false },
  image: null,
};

async function renderHome() {
  const { default: HomePage } = await import("@/app/(public)/page");
  return renderToStaticMarkup(await HomePage());
}

describe("Home (Master §53 order)", () => {
  test("hero, próximas carreras, biblioteca, información, contacto -- in that order; community omitted while unavailable", async () => {
    homeData = async () => ({ upcoming: [card], community_slot: { available: false, reason: "ranking_pending_t42" } });
    const html = await renderHome();
    const order = ["<h1", "Próximas carreras", "Busca en la biblioteca", "Eventos creados y operados por RUNIIS", "¿Dudas sobre una carrera?"].map((s) => html.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain('href="/eventos/demo-libre-5k-10k"');
    expect(html).toContain("Próxima salida");
    expect(html).not.toMatch(/podio|ranking semanal/i);
  });

  test("a load failure is an error state, never the empty state (Master §56)", async () => {
    homeData = () => Promise.reject(new Error("db down"));
    const html = await renderHome();
    expect(html).toContain("No pudimos cargar las próximas carreras");
    expect(html).not.toContain("No hay próximos eventos");
  });

  test("no upcoming Editions -> 'No hay próximos eventos'", async () => {
    homeData = async () => ({ upcoming: [], community_slot: { available: false, reason: "x" } });
    const html = await renderHome();
    expect(html).toContain("No hay próximos eventos");
    expect(html).not.toContain("Próxima salida");
  });
});
