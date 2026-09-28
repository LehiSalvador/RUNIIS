import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { JsonLd, serializeJsonLd } from "@/components/public/json-ld";
import { Markdown, safeMarkdownUrl } from "@/components/public/markdown";
import { publicMediaUrl } from "@/lib/shared/media-url";
import { buildPublicCsp, isCachedPublicPath, isNoReferrerPath, normalizePath } from "@/proxy";

const REPORT_URL = "https://runiis.mx/api/csp-report";

describe("JSON-LD (SEC-060/SEC-061, F8)", () => {
  test("a </script> inside editor text cannot close the script element", () => {
    const html = renderToStaticMarkup(<JsonLd data={{ name: "x</script><script>alert(1)</script>" }} />);
    expect(html.match(/<\/script>/g)).toHaveLength(1);
    expect(JSON.parse(serializeJsonLd({ name: "a<b" }))).toEqual({ name: "a<b" });
  });

  test("the serialized string never contains a raw '<', only the \\u003c escape", () => {
    const serialized = serializeJsonLd({ n: "<script>alert(1)</script>" });
    expect(serialized).not.toContain("<");
    expect(serialized).toContain("\\u003c");
    expect(JSON.parse(serialized)).toEqual({ n: "<script>alert(1)</script>" });
  });

  test("also escapes >, &, U+2028 and U+2029", () => {
    // Built via fromCharCode, not typed as a literal/escaped line or paragraph separator in this
    // source file, since those are invisible and easy to corrupt silently in an editor round-trip.
    const lineSep = String.fromCharCode(0x2028);
    const paraSep = String.fromCharCode(0x2029);
    const input = `a&b>c${lineSep}${paraSep}`;
    const serialized = serializeJsonLd({ n: input });
    expect(serialized).not.toContain(">");
    expect(serialized).not.toContain("&");
    expect(serialized).not.toContain(lineSep);
    expect(serialized).not.toContain(paraSep);
    expect(serialized).toContain("\\u0026");
    expect(serialized).toContain("\\u003e");
    expect(serialized).toContain("\\u2028");
    expect(serialized).toContain("\\u2029");
    expect(JSON.parse(serialized)).toEqual({ n: input });
  });
});

describe("Markdown (SEC-061/062)", () => {
  test("raw HTML is dropped, not rendered", () => {
    const html = renderToStaticMarkup(<Markdown>{"Hola <img src=x onerror=alert(1)> <script>alert(1)</script> **fin**"}</Markdown>);
    expect(html).not.toMatch(/<img|<script|onerror/);
    expect(html).toContain("<strong>fin</strong>");
  });

  test("link schemes are allowlisted and external links are marked", () => {
    expect(safeMarkdownUrl("javascript:alert(1)")).toBeNull();
    expect(safeMarkdownUrl("data:text/html,x")).toBeNull();
    expect(safeMarkdownUrl("//evil.example")).toBeNull();
    expect(safeMarkdownUrl("/eventos")).toBe("/eventos");
    expect(safeMarkdownUrl("mailto:hola@example.com")).toBe("mailto:hola@example.com");
    const html = renderToStaticMarkup(<Markdown>{"[a](javascript:alert(1)) [b](https://example.com/x) ![i](https://example.com/i.png)"}</Markdown>);
    expect(html).not.toContain("javascript:");
    const link = html.match(/<a [^>]*href="https:\/\/example.com\/x"[^>]*>/)?.[0] ?? "";
    expect(link).toContain('target="_blank"');
    expect(link).toContain('rel="noopener noreferrer nofollow ugc"');
    expect(html).not.toContain("<img");
  });
});

describe("publicMediaUrl", () => {
  test("Cloudinary delivery URL with transforms", () => {
    expect(publicMediaUrl("runiis/local/editions/e1/hero.jpg", { width: 800, aspect: "4:3" }, "demo-cloud")).toBe(
      "https://res.cloudinary.com/demo-cloud/image/upload/f_auto,q_auto,c_fill,g_auto,w_800,ar_4:3/runiis/local/editions/e1/hero.jpg",
    );
  });
  test("no cloud configured, traversal or odd keys -> null (caller uses the no-photo tile)", () => {
    expect(publicMediaUrl("runiis/x.jpg", { width: 800 }, null)).toBeNull();
    expect(publicMediaUrl("runiis/../secret", { width: 800 }, "demo")).toBeNull();
    expect(publicMediaUrl("https://evil.example/x.jpg", { width: 800 }, "demo")).toBeNull();
  });
});

describe("public CSP split (SEC-060, F7 allowlist)", () => {
  test("cached public pages get the nonce-free policy; session surfaces do not", () => {
    for (const path of ["/", "/eventos", "/eventos/demo", "/runiis", "/contacto", "/legal/terminos", "/og", "/og/edicion.png", "/vendor/maplibre/maplibre-gl-worker.js", "/robots.txt", "/sitemap.xml"]) {
      expect(isCachedPublicPath(path)).toBe(true);
    }
    for (const path of ["/admin", "/cuenta/pases", "/scanner", "/inscripcion/demo", "/entrar", "/onboarding", "/api/v1/events", "/design-system", "/recordatorios/confirmar", "/pase/abc", "/auth/callback"]) {
      expect(isCachedPublicPath(path)).toBe(false);
    }
  });

  test("F7: case, percent-encoding and duplicate-slash variants of a private path still classify as private (fail closed, allowlist)", () => {
    for (const path of ["/ADMIN", "/%61dmin", "//admin", "/Admin/", "/cuenta;x"]) {
      expect(isCachedPublicPath(path)).toBe(false);
    }
  });

  test("F7: malformed percent-encoding never classifies as public", () => {
    expect(isCachedPublicPath("/%")).toBe(false);
  });

  test("normalizePath lower-cases, decodes and collapses duplicate slashes", () => {
    expect(normalizePath("/Eventos/Demo/")).toBe("/eventos/demo");
    expect(normalizePath("/%61dmin")).toBe("/admin");
    expect(normalizePath("//admin")).toBe("/admin");
    expect(normalizePath("/")).toBe("/");
  });

  test("public policy keeps the hard directives, only opens the map origin, blocks inline event handlers and declares reporting", () => {
    const csp = buildPublicCsp(REPORT_URL);
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("connect-src 'self' https://tiles.openfreemap.org");
    expect(csp).toContain("worker-src 'self' blob:");
    expect(csp).toContain("script-src-attr 'none'");
    expect(csp).toContain("report-to csp-endpoint");
    expect(csp).toContain(`report-uri ${REPORT_URL}`);
    expect(csp).not.toContain("nonce-");
  });
});

describe("Referrer-Policy no-referrer paths (SEC-064, F7)", () => {
  test("the auth callback and reminder confirmation pages are no-referrer", () => {
    for (const path of ["/auth/callback", "/auth/callback/", "/recordatorios/confirmar", "/RECORDATORIOS/CONFIRMAR"]) {
      expect(isNoReferrerPath(path)).toBe(true);
    }
  });
  test("other paths keep the default referrer policy", () => {
    for (const path of ["/", "/cuenta", "/auth", "/recordatorios"]) {
      expect(isNoReferrerPath(path)).toBe(false);
    }
  });
});
