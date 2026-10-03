import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { AVAILABLE_PUBLIC_ROUTES, availableLinks, isRouteAvailable } from "@/components/shell/nav-availability";
import { PUBLIC_NAV_LINKS } from "@/components/shell/public-header";
import { FOOTER_GROUPS } from "@/components/shell/public-footer";

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
    for (const href of new Set([...shellHrefs, ...AVAILABLE_PUBLIC_ROUTES])) {
      expect(routeHasPage(href), `${href} has no page.tsx`).toBe(true);
    }
  });
});
