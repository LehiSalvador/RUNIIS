import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { AVAILABLE_ROUTES, availableLinks, isRouteAvailable } from "@/components/shell/nav-availability";
import { PUBLIC_NAV_LINKS } from "@/components/shell/public-header";
import { FOOTER_GROUPS } from "@/components/shell/public-footer";

vi.mock("next/navigation", () => ({ usePathname: () => "/design-system/shells/admin" }));

const ROOT = process.cwd();

/** A route exists in this build when a page.tsx sits at its path, looking through (route-group) folders. */
function hasPage(dir: string, segments: string[]): boolean {
  if (segments.length === 0) {
    return existsSync(join(dir, "page.tsx")) || groupDirs(dir).some((group) => hasPage(group, []));
  }
  const [head, ...rest] = segments;
  return hasPage(join(dir, head), rest) || groupDirs(dir).some((group) => hasPage(group, segments));
}

function groupDirs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\(.+\)$/.test(entry.name))
    .map((entry) => join(dir, entry.name));
}

const routeHasPage = (href: string) => hasPage(join(ROOT, "app"), href.split("/").filter(Boolean));

describe("nav availability rule", () => {
  test("a route is available only when it is listed", () => {
    expect(isRouteAvailable("/eventos")).toBe(true);
    expect(isRouteAvailable("/ranking")).toBe(false);
    expect(isRouteAvailable("/eventos/")).toBe(false);
  });

  test("availableLinks drops unlisted routes and preserves order", () => {
    const links = [
      { href: "/contacto", label: "Contacto" },
      { href: "/ranking", label: "Ranking" },
      { href: "/eventos", label: "Eventos" },
    ];
    expect(availableLinks(links).map((l) => l.href)).toEqual(["/contacto", "/eventos"]);
  });
});

describe("public shell links point only to routes that exist", () => {
  test("header (and mobile drawer) nav omits the unbuilt /ranking route", () => {
    const hrefs = PUBLIC_NAV_LINKS.map((l) => l.href);
    expect(hrefs).toEqual(["/eventos", "/runiis", "/contacto"]);
  });

  test("footer omits the unbuilt /ranking route and keeps every other link", () => {
    const hrefs = FOOTER_GROUPS.flatMap((g) => g.links.map((l) => l.href));
    expect(hrefs).not.toContain("/ranking");
    expect(hrefs).toEqual(["/eventos", "/runiis", "/contacto", "/legal/terminos", "/legal/privacidad"]);
  });

  test("every rendered shell href and every listed route has a page in app/", () => {
    const shellHrefs = [...PUBLIC_NAV_LINKS.map((l) => l.href), ...FOOTER_GROUPS.flatMap((g) => g.links.map((l) => l.href))];
    for (const href of new Set([...shellHrefs, ...AVAILABLE_ROUTES])) {
      expect(routeHasPage(href), `${href} has no page.tsx`).toBe(true);
    }
  });
});

describe("admin and account shells never link to an unbuilt route", () => {
  const hrefsIn = (html: string) => [...html.matchAll(/<a[^>]*\shref="([^"]+)"/g)].map((m) => m[1]);

  test("admin shell (live): only built /admin routes are ever rendered, and none without explicit permitted keys", async () => {
    const { AdminShell } = await import("@/components/shell/admin-shell");
    const all = ["dashboard", "tareas", "eventos", "solicitudes", "participantes", "asistencia", "cierre", "auditoria"] as const;
    const html = renderToStaticMarkup(
      <AdminShell pageTitle="Dashboard" navMode="live" visibleNavKeys={all}>
        x
      </AdminShell>,
    );
    // Phase 3 so far builds only the dashboard and the events list; everything else stays out of the DOM.
    expect([...new Set(hrefsIn(html).filter((href) => href.startsWith("/admin")))].sort()).toEqual(["/admin", "/admin/eventos"]);
    expect(html).not.toContain("Participantes");
    expect(html).not.toContain("aria-disabled");
    const closed = renderToStaticMarkup(
      <AdminShell pageTitle="Dashboard" navMode="live">
        x
      </AdminShell>,
    );
    expect(hrefsIn(closed).filter((href) => href.startsWith("/admin") && href !== "/admin")).toEqual([]);
  });

  test("admin shell on /design-system (default mode): built routes navigate, unbuilt ones are non-navigating aria-disabled entries", async () => {
    const { AdminShell } = await import("@/components/shell/admin-shell");
    const keys = ["dashboard", "tareas", "eventos", "solicitudes", "participantes", "asistencia"] as const;
    const html = renderToStaticMarkup(
      <AdminShell pageTitle="Dashboard" visibleNavKeys={keys}>
        x
      </AdminShell>,
    );
    expect([...new Set(hrefsIn(html).filter((href) => href.startsWith("/admin")))].sort()).toEqual(["/admin", "/admin/eventos"]);
    expect(html.match(/role="link" aria-disabled="true"/g)).toHaveLength(keys.length - 2);
    expect(html).toContain("Participantes");
  });

  test("account shell nav lists only built routes and keeps all current entries", async () => {
    const { ACCOUNT_NAV_ITEMS } = await import("@/components/shell/account-shell");
    expect(ACCOUNT_NAV_ITEMS).toHaveLength(9);
    for (const item of ACCOUNT_NAV_ITEMS) expect(routeHasPage(item.href), item.href).toBe(true);
  });
});
