import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { RevisionStatusBadge, SOURCE_LABEL } from "@/components/admin/routes/revision-badges";
import { RouteSummary } from "@/components/admin/routes/route-summary";
import { ValidationPanel } from "@/components/admin/routes/validation-panel";
import { EDITION_LINK_CANDIDATES, editionQuickLinks } from "@/components/admin/edition-links";
import { isRouteAvailable } from "@/components/shell/nav-availability";
import type { PoiDraft } from "@/components/admin/routes/route-geometry";

const modalities = [{ modality_id: "m1", name: "10K", official_distance_m: 10000, status: "ACTIVE" }];
const modalityName = (id: string) => (id === "m1" ? "10K" : null);

describe("ValidationPanel shows the server verdict and never computes one", () => {
  test("errors in a danger list, warnings in a warning list", () => {
    const html = renderToStaticMarkup(
      <ValidationPanel
        validation={{ valid: false, errors: [{ code: "INVALID_GEOMETRY" }], warnings: [{ code: "START_FINISH_MISSING", detail: { has_start: false, has_finish: false } }], validated_at: "2026-10-03T16:00:00Z" }}
        dirty={false}
        editable
        modalityName={modalityName}
        timeZone="America/Monterrey"
      />,
    );
    expect(html).toContain("1 error impide publicar");
    expect(html).toContain("La geometría de la ruta no es válida");
    expect(html).toContain("1 advertencia");
    expect(html).toContain("Falta definir la salida y la meta.");
    expect(html).not.toContain("Sin errores bloqueantes");
  });

  test("a clean result says so, and unsaved edits are called out", () => {
    const html = renderToStaticMarkup(
      <ValidationPanel validation={{ valid: true, errors: [], warnings: [] }} dirty editable modalityName={modalityName} timeZone="America/Monterrey" />,
    );
    expect(html).toContain("Sin errores bloqueantes");
    expect(html).toContain("Sin advertencias.");
    expect(html).toContain("cambios sin guardar que esta validación no incluye");
  });

  test("no result yet: an editable draft is told to save and validate; a published revision is told it stores none", () => {
    const draft = renderToStaticMarkup(<ValidationPanel validation={null} dirty={false} editable modalityName={modalityName} timeZone="UTC" />);
    expect(draft).toContain("Guarda el borrador y pulsa");
    const published = renderToStaticMarkup(<ValidationPanel validation={null} dirty={false} editable={false} modalityName={modalityName} timeZone="UTC" />);
    expect(published).toContain("no guarda un resultado de validación");
  });
});

describe("RouteSummary keeps three distances apart", () => {
  const poi = (key: string, poi_type: PoiDraft["poi_type"], name: string): PoiDraft => ({ key, poi_type, name, description: "", longitude: -100.3, latitude: 25.6 });
  test("on-screen, server and official distances, start and finish, elevation note", () => {
    const html = renderToStaticMarkup(
      <RouteSummary
        coords={[[-100.3, 25.6], [-100.2, 25.6]]}
        pois={[poi("s", "START", "Arco"), poi("f", "FINISH", "Meta"), poi("h", "HYDRATION", "Agua")]}
        computedM={10234}
        serverDistanceM={10231}
        modalities={modalities}
        saved
      />,
    );
    expect(html).toContain("10.23 km");
    expect(html).toContain("Distancia calculada por el servidor");
    expect(html).toContain("10K: 10.0 km");
    expect(html).toContain("Arco (25.600000, -100.300000)");
    expect(html).toContain("1 además de salida y meta");
    expect(html).toContain("No disponible");
    expect(html).toContain("nunca la cambia");
  });

  test("an unsaved revision has no server distance yet and no start or finish", () => {
    const html = renderToStaticMarkup(<RouteSummary coords={[]} pois={[]} computedM={0} serverDistanceM={null} modalities={[]} saved={false} />);
    expect(html).toContain("Aún no se guarda");
    expect(html).toContain("Sin definir");
    expect(html).toContain("La ruta no tiene modalidades.");
  });
});

describe("badges and navigation", () => {
  test("revision states carry a label, not only a colour", () => {
    expect(renderToStaticMarkup(<RevisionStatusBadge value="DRAFT" />)).toContain("Borrador");
    expect(renderToStaticMarkup(<RevisionStatusBadge value="PUBLISHED" />)).toContain("Publicada");
    expect(renderToStaticMarkup(<RevisionStatusBadge value="SUPERSEDED" />)).toContain("Reemplazada");
    expect(Object.keys(SOURCE_LABEL).sort()).toEqual(["DUPLICATED", "GPX_IMPORT", "MANUAL"]);
  });

  test("the Edition quick link to Rutas points at a route that is built and only shows to the roles that may use it", () => {
    const candidate = EDITION_LINK_CANDIDATES.find((entry) => entry.key === "ruta");
    expect(candidate?.route).toBe("/admin/eventos/[editionId]/rutas");
    expect(isRouteAvailable("/admin/eventos/[editionId]/rutas")).toBe(true);
    const id = "50000000-0000-4000-8000-000000340001";
    const admin = editionQuickLinks(id, [{ role: "ADMIN", scope_type: "GLOBAL", edition_id: null }]);
    expect(admin.find((link) => link.key === "ruta")?.href).toBe(`/admin/eventos/${id}/rutas`);
    expect(editionQuickLinks(id, [{ role: "CHECKIN", scope_type: "GLOBAL", edition_id: null }]).some((link) => link.key === "ruta")).toBe(false);
  });
});
