import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { JsonLd, serializeJsonLd } from "@/components/public/json-ld";
import { Markdown, safeMarkdownUrl } from "@/components/public/markdown";
import { publicMediaUrl } from "@/lib/shared/media-url";
import { buildPublicCsp, isCachedPublicPath } from "@/proxy";

describe("JSON-LD (SEC-060)", () => {
  test("a </script> inside editor text cannot close the script element", () => {
    const html = renderToStaticMarkup(<JsonLd data={{ name: "x</script><script>alert(1)</script>" }} />);
    expect(html.match(/<\/script>/g)).toHaveLength(1);
    expect(JSON.parse(serializeJsonLd({ name: "a<b" }))).toEqual({ name: "a<b" });
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

describe("public CSP split (SEC-060)", () => {
  test("cached public pages get the nonce-free policy; session surfaces do not", () => {
    for (const path of ["/", "/eventos", "/eventos/demo", "/runiis", "/contacto", "/legal/terminos", "/og", "/vendor/maplibre/maplibre-gl-worker.mjs"]) {
      expect(isCachedPublicPath(path)).toBe(true);
    }
    for (const path of ["/admin", "/cuenta/pases", "/scanner", "/inscripcion/demo", "/entrar", "/api/v1/events", "/design-system"]) {
      expect(isCachedPublicPath(path)).toBe(false);
    }
  });
  test("public policy keeps the hard directives and only opens the map origin", () => {
    const csp = buildPublicCsp();
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("connect-src 'self' https://tiles.openfreemap.org");
    expect(csp).toContain("worker-src 'self' blob:");
    expect(csp).not.toContain("nonce-");
  });
});
