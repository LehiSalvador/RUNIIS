import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import type { StaffAssignment } from "@/components/admin/access";
import { parseAvailability, occupancyPercent, CapacitySummary } from "@/components/admin/capacity";
import { CursorPager } from "@/components/admin/cursor-pager";
import { editionMetrics, upcomingEditions } from "@/components/admin/dashboard-metrics";
import { EDITION_LINK_CANDIDATES, editionQuickLinks } from "@/components/admin/edition-links";
import { enumParam, firstParam, nextQuery, withQuery } from "@/components/admin/filters";
import { formatCalendarDate, formatClock, formatDateTime, formatSchedule } from "@/components/admin/format";
import { Panel, StatTile } from "@/components/admin/panel";
import { ReadinessChecklist, readinessLabel } from "@/components/admin/readiness-checklist";
import { ExecutionBadge, PublicationBadge, RegistrationBadge } from "@/components/admin/status-badges";
import { AdminForbidden, AdminNotFound } from "@/components/admin/access-states";
import { isRouteAvailable } from "@/components/shell/nav-availability";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/eventos",
  useRouter: () => ({ refresh: () => undefined, replace: () => undefined, push: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}));

const EDITION = "5a000000-0000-4000-8000-00000000000a";
const operator: StaffAssignment[] = [{ role: "OPERATOR", scope_type: "GLOBAL", edition_id: null }];
const checkin: StaffAssignment[] = [{ role: "CHECKIN", scope_type: "GLOBAL", edition_id: null }];

describe("filters (URL state)", () => {
  test("a changed filter drops the cursor so paging restarts", () => {
    expect(nextQuery("search=ab&cursor=XYZ", { publication_state: "DRAFT" })).toBe("search=ab&publication_state=DRAFT");
    expect(nextQuery("search=ab&publication_state=DRAFT", { search: null })).toBe("publication_state=DRAFT");
    expect(nextQuery("", { search: "  " })).toBe("");
    expect(withQuery("/admin/eventos", "")).toBe("/admin/eventos");
    expect(withQuery("/admin/eventos", "a=1")).toBe("/admin/eventos?a=1");
  });

  test("params are read defensively: first value, trimmed, allow-listed", () => {
    expect(firstParam({ q: ["  a ", "b"] }, "q")).toBe("a");
    expect(firstParam({ q: "  " }, "q")).toBeUndefined();
    expect(enumParam({ s: "DRAFT" }, "s", ["DRAFT", "PUBLISHED"] as const)).toBe("DRAFT");
    expect(enumParam({ s: "'; drop table" }, "s", ["DRAFT", "PUBLISHED"] as const)).toBeUndefined();
  });
});

describe("format", () => {
  test("calendar dates are never shifted by a timezone", () => {
    expect(formatCalendarDate("2026-10-03")).toBe("3 oct 2026");
    expect(formatCalendarDate(null)).toBe("—");
    expect(formatCalendarDate("garbage")).toBe("—");
  });

  test("instants render in the edition zone, not the viewer's", () => {
    // 2026-10-03T03:30:00Z is 21:30 on Oct 2 in Monterrey (UTC-6) and 12:30 on Oct 3 in Tokyo.
    expect(formatDateTime("2026-10-03T03:30:00Z", "America/Monterrey")).toContain("21:30");
    expect(formatDateTime("2026-10-03T03:30:00Z", "Asia/Tokyo")).toContain("12:30");
    expect(formatDateTime("2026-10-03T03:30:00Z", "Not/AZone")).toContain("21:30");
    expect(formatDateTime(null)).toBe("—");
  });

  test("clock and schedule", () => {
    expect(formatClock("06:30:00")).toBe("06:30");
    expect(formatSchedule("2026-10-03", "06:30:00")).toBe("3 oct 2026 · 06:30");
    expect(formatSchedule(null, "06:30:00")).toBe("Sin fecha");
  });
});

describe("status badges", () => {
  test("icon plus label, never color alone, and unknown values degrade", () => {
    const html = renderToStaticMarkup(
      <>
        <PublicationBadge value="DRAFT" />
        <RegistrationBadge value="OPEN" />
        <ExecutionBadge value="IN_PROGRESS" />
        <ExecutionBadge value="WEIRD" />
      </>,
    );
    expect(html).toContain("Borrador");
    expect(html).toContain("Abierta");
    expect(html).toContain("En curso");
    expect(html).toContain("WEIRD");
    expect(html.match(/<svg/g)?.length).toBe(4);
  });
});

describe("readiness checklist", () => {
  test("failing conditions are listed before passing ones and say so to screen readers", () => {
    const html = renderToStaticMarkup(
      <ReadinessChecklist
        title="Publicación"
        ready={false}
        checks={[
          { code: "SLUG_VALID", ok: true },
          { code: "MAIN_IMAGE", ok: false },
          { code: "BRAND_NEW_CHECK", ok: false },
        ]}
      />,
    );
    expect(html.indexOf("Imagen principal")).toBeLessThan(html.indexOf("Enlace público"));
    expect(html).toContain("2 por resolver");
    expect(html).toContain("Pendiente: ");
    expect(html).toContain("Cumple: ");
    expect(readinessLabel("BRAND_NEW_CHECK")).toBe("Brand new check");
  });

  test("a ready checklist says Lista", () => {
    expect(renderToStaticMarkup(<ReadinessChecklist title="Inscripciones" ready checks={[{ code: "EDITION_PUBLISHED", ok: true }]} />)).toContain("Lista");
  });
});

describe("capacity summary", () => {
  const raw = {
    edition_id: EDITION,
    global: { capacity: 100, confirmed: 40, active_holds: 10, available: 50, state: "AVAILABLE" },
    modalities: [{ modality_id: "m1", status: "ACTIVE", effective_capacity: 60, confirmed: 55, active_holds: 5, available: 0, state: "TEMPORARILY_UNAVAILABLE" }],
  };

  test("parses the availability projection and computes occupancy", () => {
    expect(parseAvailability(raw)?.global.capacity).toBe(100);
    expect(occupancyPercent(100, 40, 10)).toBe(50);
    expect(occupancyPercent(60, 55, 5)).toBe(100);
    expect(occupancyPercent(null, 5, 5)).toBeNull();
    expect(occupancyPercent(0, 0, 0)).toBeNull();
  });

  test("renders per-modality names and a labelled meter", () => {
    const html = renderToStaticMarkup(<CapacitySummary availability={raw} modalityNames={{ m1: "10K" }} />);
    expect(html).toContain("Total de la edición");
    expect(html).toContain("10K");
    expect(html).toContain('role="meter"');
    expect(html).toContain("Confirmados 40");
    expect(html).toContain("Agotado por apartados");
  });

  test("an unexpected shape degrades to a message instead of throwing", () => {
    expect(parseAvailability({ nope: true })).toBeNull();
    expect(renderToStaticMarkup(<CapacitySummary availability={{ nope: true }} modalityNames={{}} />)).toContain("Cupo no disponible");
  });
});

describe("dashboard metrics", () => {
  const items = [
    { publication_state: "PUBLISHED", registration_state: "OPEN", execution_state: "SCHEDULED", sport_date: "2026-11-01" },
    { publication_state: "PUBLISHED", registration_state: "CLOSED", execution_state: "SCHEDULED", sport_date: "2026-09-01" },
    { publication_state: "DRAFT", registration_state: "NOT_OPEN", execution_state: "SCHEDULED", sport_date: "2026-12-01" },
    { publication_state: "PUBLISHED", registration_state: "CLOSED", execution_state: "IN_PROGRESS", sport_date: "2026-10-03" },
    { publication_state: "PUBLISHED", registration_state: "OPEN", execution_state: "SCHEDULED", sport_date: "2026-10-20" },
  ];

  test("counts what the Editions list can prove", () => {
    expect(editionMetrics(items, "2026-10-03")).toEqual({ upcoming: 2, registrationOpen: 2, drafts: 1, inProgress: 1 });
  });

  test("upcoming list is published + scheduled + dated, soonest first", () => {
    expect(upcomingEditions(items, "2026-10-03").map((item) => item.sport_date)).toEqual(["2026-10-20", "2026-11-01"]);
    expect(upcomingEditions(items, "2026-10-03", 1)).toHaveLength(1);
  });
});

describe("edition quick links", () => {
  test("only built routes the role can open are linked: the P3-E1/P3-E2 configuration sections, the P3-F routes, the P3-G request queue and participants and the P3-H race day surfaces and the P3-I attendance and closure pages are built", () => {
    const BUILT = ["configuracion", "modalidades", "formularios", "ubicaciones", "agenda", "contenido", "ruta", "solicitudes", "participantes", "kits", "tutores", "escaner", "asistencia", "cierre"];
    // the closure is an ADMIN surface (Master section 145): an operator is linked to the attendance desk only
    expect(editionQuickLinks(EDITION, operator).map((link) => link.key)).toEqual(BUILT.filter((key) => key !== "cierre"));
    expect(editionQuickLinks(EDITION, [{ role: "ADMIN", scope_type: "GLOBAL", edition_id: null }]).map((link) => link.key)).toEqual(BUILT);
    for (const candidate of EDITION_LINK_CANDIDATES) expect(isRouteAvailable(candidate.route), candidate.route).toBe(BUILT.includes(candidate.key));
  });

  test("a section appears the moment its route is listed, and only for roles that may open it", () => {
    const built = (route: string) => ["/admin/eventos/[editionId]/solicitudes", "/admin/eventos/[editionId]/cierre"].includes(route);
    expect(editionQuickLinks(EDITION, operator, built).map((link) => link.key)).toEqual(["solicitudes"]);
    expect(editionQuickLinks(EDITION, operator, built)[0].href).toBe(`/admin/eventos/${EDITION}/solicitudes`);
    expect(editionQuickLinks(EDITION, checkin, built)).toEqual([]);
    const admin: StaffAssignment[] = [{ role: "ADMIN", scope_type: "GLOBAL", edition_id: null }];
    expect(editionQuickLinks(EDITION, admin, built).map((link) => link.key)).toEqual(["solicitudes", "cierre"]);
  });

  test("an EDITION-scoped role gets links only for its own Edition", () => {
    const scoped: StaffAssignment[] = [{ role: "OPERATOR", scope_type: "EDITION", edition_id: EDITION }];
    const built = () => true;
    expect(editionQuickLinks(EDITION, scoped, built).length).toBeGreaterThan(0);
    expect(editionQuickLinks("5b000000-0000-4000-8000-00000000000b", scoped, built)).toEqual([]);
  });

  test("race day surfaces are gated by their own role list: CHECKIN gets the guardian desk and the scanner, never the kit centre", () => {
    const built = () => true;
    const keys = (assignments: StaffAssignment[]) => editionQuickLinks(EDITION, assignments, built).map((link) => link.key);
    expect(keys(checkin)).toEqual(["tutores", "escaner"]);
    expect(keys(operator)).toEqual(expect.arrayContaining(["kits", "tutores", "escaner"]));
    expect(keys([{ role: "MODERATOR", scope_type: "GLOBAL", edition_id: null }])).toEqual([]);
    expect(editionQuickLinks(EDITION, checkin, built).find((link) => link.key === "escaner")?.href).toBe("/scanner");
    expect(editionQuickLinks(EDITION, operator, built).find((link) => link.key === "kits")?.href).toBe(`/admin/eventos/${EDITION}/kits`);
  });
});

describe("shared layout pieces", () => {
  test("StatTile links through to the full surface and never prefetches", () => {
    const linked = renderToStaticMarkup(<StatTile label="Borradores" value="3" href="/admin/eventos?publication_state=DRAFT" />);
    expect(linked).toContain('href="/admin/eventos?publication_state=DRAFT"');
    expect(linked).toContain("Borradores");
    expect(renderToStaticMarkup(<StatTile label="X" value="1" />)).not.toContain("<a ");
  });

  test("Panel labels its region by its heading", () => {
    const html = renderToStaticMarkup(<Panel title="Capacidad">x</Panel>);
    const labelledBy = /aria-labelledby="([^"]+)"/.exec(html)?.[1];
    expect(labelledBy).toBeTruthy();
    expect(html).toContain(`id="${labelledBy}"`);
  });

  test("CursorPager renders nothing for one page, and plain links otherwise", () => {
    expect(renderToStaticMarkup(<CursorPager shown={5} nextHref={null} firstHref={null} />)).toBe("");
    const html = renderToStaticMarkup(<CursorPager shown={20} nextHref="/admin/eventos?cursor=abc" firstHref="/admin/eventos" />);
    expect(html).toContain('href="/admin/eventos?cursor=abc"');
    expect(html).toContain('href="/admin/eventos"');
    expect(html).toContain("Siguiente página");
  });

  test("forbidden and not-found states never leak what exists or which role would work", () => {
    const forbidden = renderToStaticMarkup(<AdminForbidden />);
    expect(forbidden).toContain("No tienes acceso a esta sección");
    expect(forbidden).not.toMatch(/ADMIN|OPERATOR|CHECKIN|MODERATOR/);
    expect(renderToStaticMarkup(<AdminForbidden staff={false} />)).toContain('href="/cuenta"');
    expect(renderToStaticMarkup(<AdminNotFound backHref="/admin/eventos" backLabel="Volver" />)).toContain("No encontramos este registro");
  });
});
