import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { NAV_ACCESS, visibleNavKeysFor, type StaffAssignment, type StaffRole } from "@/components/admin/access";
import { AdminPage } from "@/components/admin/admin-page";
import { ErrorNotice } from "@/components/admin/error-notice";
import { ADMIN_NAV_ITEMS, ADMIN_NAV_KEYS } from "@/components/shell/admin-nav-items";
import { AVAILABLE_ROUTES, isRouteAvailable } from "@/components/shell/nav-availability";
import { AdminShell } from "@/components/shell/admin-shell";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin",
  useRouter: () => ({ refresh: () => undefined, replace: () => undefined, push: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}));

const ROOT = process.cwd();
const global = (role: StaffRole): StaffAssignment[] => [{ role, scope_type: "GLOBAL", edition_id: null }];
const navHrefs = (html: string) => [...html.matchAll(/<a[^>]*\shref="([^"]+)"/g)].map((match) => match[1]).filter((href) => href.startsWith("/admin"));

function adminPages(dir = join(ROOT, "app", "admin")): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return adminPages(path);
    return entry.name === "page.tsx" ? [path] : [];
  });
}

describe("admin shell navigation (P3-AC-05)", () => {
  test("the shell is the only place a nav item can come from, and its values are readable on the server", () => {
    expect(ADMIN_NAV_KEYS).toEqual(ADMIN_NAV_ITEMS.map((item) => item.key));
    expect(Object.keys(NAV_ACCESS)).toHaveLength(ADMIN_NAV_ITEMS.length);
  });

  test("a live shell without explicit permitted keys links to nothing (fail closed)", () => {
    const html = renderToStaticMarkup(<AdminShell pageTitle="X" navMode="live">x</AdminShell>);
    expect(navHrefs(html).filter((href) => href !== "/admin")).toEqual([]);
    expect(html).not.toContain("Eventos");
  });

  test.each<[StaffRole, string[]]>([
    ["ADMIN", ["/admin", "/admin/eventos"]],
    ["OPERATOR", ["/admin", "/admin/eventos"]],
    ["CHECKIN", ["/admin"]],
    ["MODERATOR", ["/admin"]],
  ])("%s gets only built routes it may use", (role, expected) => {
    const html = renderToStaticMarkup(
      <AdminShell pageTitle="X" navMode="live" visibleNavKeys={visibleNavKeysFor(global(role), ADMIN_NAV_KEYS)}>
        x
      </AdminShell>,
    );
    // the wordmark also links to /admin; the nav links are the aria-current/aria-less anchors with a label
    const links = [...new Set(navHrefs(html))].sort();
    expect(links).toEqual([...expected].sort());
    expect(html).not.toContain('aria-disabled="true"');
  });

  test("a role never gets a nav label for a section it cannot use, even if the route is built", () => {
    const html = renderToStaticMarkup(
      <AdminShell pageTitle="X" navMode="live" visibleNavKeys={visibleNavKeysFor(global("CHECKIN"), ADMIN_NAV_KEYS)}>
        x
      </AdminShell>,
    );
    expect(html).not.toContain(">Eventos<");
    expect(html).toContain("Dashboard");
  });

  test("AdminPage composes the live shell with the viewer's nav and identity footer", () => {
    const html = renderToStaticMarkup(
      <AdminPage assignments={global("OPERATOR")} title="Eventos">
        <p>contenido</p>
      </AdminPage>,
    );
    expect(html).toContain('<h1 class="text-h3 font-body font-bold text-ink">Eventos</h1>');
    expect(html).toContain("Operador · Global");
    expect(html).toContain("Cerrar sesión");
    expect(navHrefs(html)).toContain("/admin/eventos");
  });

  test("every listed /admin route has a page, and every built admin nav item is listed", () => {
    for (const route of AVAILABLE_ROUTES.filter((route) => route.startsWith("/admin"))) {
      const dir = join(ROOT, "app", ...route.split("/").filter(Boolean));
      expect(existsSync(join(dir, "page.tsx")), `${route} has no page.tsx`).toBe(true);
    }
    for (const item of ADMIN_NAV_ITEMS) {
      const dir = join(ROOT, "app", ...item.href.split("/").filter(Boolean));
      expect(isRouteAvailable(item.href), item.href).toBe(existsSync(join(dir, "page.tsx")));
    }
  });
});

describe("server-side authorization is the authority", () => {
  test("every admin page resolves the staff session and role on the server before rendering", () => {
    const pages = adminPages();
    expect(pages.length).toBeGreaterThanOrEqual(3);
    for (const page of pages) {
      const source = readFileSync(page, "utf8");
      expect(source, page).toMatch(/await requireStaff\(/);
      expect(source, page).toMatch(/if \(!gate\.allowed\) return gate\.forbidden;/);
      // the guard runs before any data read or JSX
      expect(source.indexOf("requireStaff("), page).toBeLessThan(source.indexOf("<AdminPage"));
    }
  });

  test("no route-level loading boundary under /admin (it would turn the anonymous redirect into a streamed meta refresh)", () => {
    const stack = [join(ROOT, "app", "admin")];
    const loading: string[] = [];
    while (stack.length > 0) {
      const dir = stack.pop()!;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) stack.push(join(dir, entry.name));
        else if (entry.name === "loading.tsx") loading.push(join(dir, entry.name));
      }
    }
    expect(loading).toEqual([]);
  });
});

describe("ErrorNotice", () => {
  test("shows the actionable message, the kind and the support reference, never server text", () => {
    const html = renderToStaticMarkup(<ErrorNotice code="CONFLICT" requestId="9f1c-req" />);
    expect(html).toContain("Alguien más lo cambió");
    expect(html).toContain("Actualizar datos");
    expect(html).toContain("9f1c-req");
    expect(html).toContain("Datos desactualizados");
  });

  test("a failed read offers a retry; a dead session offers sign-in back to this page", () => {
    expect(renderToStaticMarkup(<ErrorNotice code="DEPENDENCY_UNAVAILABLE" />)).toContain("Reintentar");
    const signin = renderToStaticMarkup(<ErrorNotice code="AUTH_REQUIRED" />);
    expect(signin).toContain('href="/entrar?next=%2Fadmin"');
  });

  test("permission errors offer no retry that cannot succeed", () => {
    const html = renderToStaticMarkup(<ErrorNotice code="FORBIDDEN" requestId="r1" />);
    expect(html).not.toContain("Reintentar");
    expect(html).toContain("Sin permiso para esta acción");
  });
});
