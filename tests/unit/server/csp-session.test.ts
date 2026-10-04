import { describe, expect, test } from "vitest";
import { buildCsp, buildPublicCsp, isStaffRouteEditorPath } from "@/proxy";

// P3-M: the nonce CSP for session surfaces gets an explicit worker-src 'self' (the ALTCHA solver is a same-origin module Worker; 'strict-dynamic'
// makes browsers ignore 'self' in script-src, which is where an unset worker-src falls back to). Nothing else may loosen.

const REPORT_URL = "https://runiis.mx/api/csp-report";
const NONCE = "abc123nonce";

describe("session CSP (buildCsp)", () => {
  const directives = buildCsp(NONCE, REPORT_URL).split("; ");

  test("allows workers from our own origin only", () => {
    expect(directives).toContain("worker-src 'self'");
    expect(directives.filter((d) => d.startsWith("worker-src"))).toHaveLength(1);
    expect(directives.join(";")).not.toMatch(/worker-src[^;]*(blob:|\*|https?:|data:)/);
  });

  test("every other directive is exactly what it was before (script-src stays nonce + strict-dynamic)", () => {
    const rest = directives.filter((d) => !d.startsWith("worker-src"));
    const devEval = process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : "";
    expect(rest).toEqual([
      "default-src 'self'",
      `script-src 'self' 'nonce-${NONCE}' 'strict-dynamic'${devEval}`,
      "script-src-attr 'none'",
      "style-src 'self' 'unsafe-inline'",
      expect.stringMatching(/^img-src 'self' data: blob:/),
      "font-src 'self'",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "object-src 'none'",
      "form-action 'self'",
      "report-to csp-endpoint",
      `report-uri ${REPORT_URL}`,
    ]);
  });

  test("the public (cached) policy is untouched", () => {
    const csp = buildPublicCsp(REPORT_URL);
    expect(csp).toContain("worker-src 'self' blob:");
    expect(csp).not.toContain("nonce-");
  });
});

// P3-F-11: only the staff route editor may reach the OpenFreeMap tile origin; everything else keeps connect-src 'self'.
describe("staff route editor CSP (P3-F-11)", () => {
  const TILES = "https://tiles.openfreemap.org";
  const connect = (csp: string) => csp.split("; ").find((d) => d.startsWith("connect-src"));

  test("the default session policy never includes the tile origin", () => {
    expect(connect(buildCsp(NONCE, REPORT_URL))).toBe("connect-src 'self'");
    expect(connect(buildCsp(NONCE, REPORT_URL, {}))).toBe("connect-src 'self'");
    expect(connect(buildCsp(NONCE, REPORT_URL, { mapBasemap: false }))).toBe("connect-src 'self'");
  });

  test("mapBasemap adds exactly the tile origin to connect-src and changes nothing else", () => {
    const base = buildCsp(NONCE, REPORT_URL).split("; ");
    const editor = buildCsp(NONCE, REPORT_URL, { mapBasemap: true }).split("; ");
    expect(connect(editor.join("; "))).toBe(`connect-src 'self' ${TILES}`);
    expect(editor.filter((d) => !d.startsWith("connect-src"))).toEqual(base.filter((d) => !d.startsWith("connect-src")));
    expect(editor.join(";")).not.toMatch(/(script-src|worker-src|img-src)[^;]*openfreemap/);
  });

  test.each([
    "/admin/eventos/5d0a1c2e-3b4f-4a5b-8c6d-7e8f9a0b1c2d/rutas",
    "/admin/eventos/5d0a1c2e-3b4f-4a5b-8c6d-7e8f9a0b1c2d/rutas/",
    "/admin/eventos/5d0a1c2e-3b4f-4a5b-8c6d-7e8f9a0b1c2d/rutas/algo",
    "/ADMIN/Eventos/x/RUTAS",
  ])("is the route editor: %s", (path) => {
    expect(isStaffRouteEditorPath(path)).toBe(true);
  });

  test.each([
    "/admin",
    "/admin/eventos",
    "/admin/eventos/x",
    "/admin/eventos/x/tutores",
    "/admin/eventos/x/rutas-secretas",
    "/admin/eventos/x/y/rutas",
    "/admin/otro/x/rutas",
    "/cuenta/eventos/x/rutas",
    "/eventos/x/rutas",
    "//evil.example/admin/eventos/x/rutas",
    "/admin/eventos/%E0%A4%A/rutas",
    "/",
  ])("is not the route editor: %s", (path) => {
    expect(isStaffRouteEditorPath(path)).toBe(false);
  });
});
