import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { EditionSubnav } from "@/components/admin/events/edition-subnav";
import { ReadinessList } from "@/components/admin/closure/readiness-list";
import { isRouteAvailable } from "@/components/shell/nav-availability";

const EDITION = "5a000000-0000-4000-8000-00000000000a";

describe("edition sub-navigation", () => {
  test("Asistencia is listed for everyone who sees the Edition; Cierre (ADMIN only) only when the caller says so or on the page itself", () => {
    const plain = renderToStaticMarkup(<EditionSubnav editionId={EDITION} current="kits" />);
    expect(plain).toContain(`href="/admin/eventos/${EDITION}/asistencia"`);
    expect(plain).not.toContain("/cierre");
    expect(renderToStaticMarkup(<EditionSubnav editionId={EDITION} current="kits" showClosure />)).toContain(`href="/admin/eventos/${EDITION}/cierre"`);
    expect(renderToStaticMarkup(<EditionSubnav editionId={EDITION} current="cierre" />)).toContain('aria-current="page"');
  });

  test("both pages are registered as built routes", () => {
    expect(isRouteAvailable("/admin/eventos/[editionId]/asistencia")).toBe(true);
    expect(isRouteAvailable("/admin/eventos/[editionId]/cierre")).toBe(true);
  });
});

describe("readiness list", () => {
  test("failing checks come first with their detail and fix link; passing ones follow", () => {
    const html = renderToStaticMarkup(
      <ReadinessList
        title="Condiciones de cierre"
        ready={false}
        checks={[
          { code: "EXECUTION_FINISHED", ok: true },
          { code: "NO_PENDING_ATTENDANCE", ok: false, detail: { pending_count: 3 } },
          { code: "GUARDIAN_RESOLVED", ok: false, detail: { pending_count: 1 } },
        ]}
        fixFor={(code) => (code === "NO_PENDING_ATTENDANCE" ? { href: `/admin/eventos/${EDITION}/asistencia`, label: "Asistencia" } : null)}
      />,
    );
    expect(html).toContain("2 por resolver");
    expect(html.indexOf("No queda asistencia pendiente")).toBeLessThan(html.indexOf("La edición ya terminó"));
    expect(html).toContain("3 inscripciones pendientes");
    expect(html).toContain("1 tutor por verificar");
    expect(html).toContain(`href="/admin/eventos/${EDITION}/asistencia"`);
    expect(html).toContain("Resolver en Asistencia");
    expect(html).toContain("Pendiente: ");
    expect(html).toContain("Cumple: ");
  });

  test("a ready list says so", () => {
    expect(renderToStaticMarkup(<ReadinessList title="X" ready checks={[{ code: "EXECUTION_FINISHED", ok: true }]} />)).toContain("Lista");
  });
});
