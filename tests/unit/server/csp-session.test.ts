import { describe, expect, test } from "vitest";
import { buildCsp, buildPublicCsp } from "@/proxy";

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
