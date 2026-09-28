import { describe, expect, it } from "vitest";
import { renderTemplate, resolveTemplateVariables, type TemplateVariableSchema } from "@/lib/server/domain/communications/render";

const APP_BASE_URL = "https://runiis.mx";

describe("resolveTemplateVariables", () => {
  it("turns a path variable into an absolute APP_BASE_URL link", () => {
    const schema: TemplateVariableSchema = { variables: { event_path: { type: "path", source: "snapshot" } } };
    const resolved = resolveTemplateVariables(schema, { event_path: "/eventos/carrera" }, {}, APP_BASE_URL);
    expect(resolved.event_path).toBe("https://runiis.mx/eventos/carrera");
  });

  it("F10 (SEC-081): rejects a protocol-relative path variable (//host)", () => {
    const schema: TemplateVariableSchema = { variables: { event_path: { type: "path", source: "snapshot" } } };
    expect(() => resolveTemplateVariables(schema, { event_path: "//evil.test/x" }, {}, APP_BASE_URL)).toThrow();
  });

  it("F10 (SEC-081): rejects a backslash-host path variable (/\\\\host)", () => {
    const schema: TemplateVariableSchema = { variables: { event_path: { type: "path", source: "snapshot" } } };
    expect(() => resolveTemplateVariables(schema, { event_path: "/\\evil.test/x" }, {}, APP_BASE_URL)).toThrow();
  });

  it("rejects a url variable that is not same-origin as APP_BASE_URL (A9: links only ever point at our own base)", () => {
    const schema: TemplateVariableSchema = { variables: { confirm_url: { type: "url", source: "system" } } };
    expect(() => resolveTemplateVariables(schema, {}, { confirm_url: "https://evil.example/phish" }, APP_BASE_URL)).toThrow();
  });

  it("accepts a same-origin url variable", () => {
    const schema: TemplateVariableSchema = { variables: { confirm_url: { type: "url", source: "system" } } };
    const resolved = resolveTemplateVariables(schema, {}, { confirm_url: "https://runiis.mx/x?token=abc" }, APP_BASE_URL);
    expect(resolved.confirm_url).toBe("https://runiis.mx/x?token=abc");
  });

  it("throws for a missing required (non-optional) variable", () => {
    const schema: TemplateVariableSchema = { variables: { edition_name: { type: "text", source: "snapshot" } } };
    expect(() => resolveTemplateVariables(schema, {}, {}, APP_BASE_URL)).toThrow();
  });

  it("defaults a missing optional variable per type", () => {
    const schema: TemplateVariableSchema = {
      variables: {
        staff_note: { type: "multiline", source: "campaign", optional: true },
        has_pass_qr: { type: "flag", source: "system", optional: true },
        participants: { type: "list", source: "snapshot", optional: true, fields: { name: { type: "text" } } },
      },
    };
    const resolved = resolveTemplateVariables(schema, {}, {}, APP_BASE_URL);
    expect(resolved.staff_note).toBe("");
    expect(resolved.has_pass_qr).toBe(false);
    expect(resolved.participants).toEqual([]);
  });

  it("truncates text to the declared max length", () => {
    const schema: TemplateVariableSchema = { variables: { edition_name: { type: "text", max: 5, source: "snapshot" } } };
    const resolved = resolveTemplateVariables(schema, { edition_name: "Carrera Larga" }, {}, APP_BASE_URL);
    expect(resolved.edition_name).toBe("Carre");
  });

  it("resolves a list variable to an array of field records", () => {
    const schema: TemplateVariableSchema = {
      variables: { participants: { type: "list", source: "snapshot", fields: { name: { type: "text", max: 3 } } } },
    };
    const resolved = resolveTemplateVariables(schema, { participants: [{ name: "Alicia" }, { name: "Bob" }] }, {}, APP_BASE_URL);
    expect(resolved.participants).toEqual([{ name: "Ali" }, { name: "Bob" }]);
  });
});

describe("renderTemplate (SEC-081: auto-escaping)", () => {
  it("HTML-escapes an interpolated value in html output", () => {
    const out = renderTemplate("<p>Hola, {{name}}</p>", { name: '<script>alert("xss")</script>' }, { html: true });
    expect(out).toBe("<p>Hola, &lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;</p>");
    expect(out).not.toContain("<script>");
  });

  it("does not HTML-escape in text output but still collapses control characters", () => {
    const out = renderTemplate("Hola, {{name}}", { name: "Beto\r\nInyectado" }, { html: false });
    expect(out).toBe("Hola, Beto Inyectado");
    expect(out).not.toContain("\r");
  });

  it("renders a truthy flag section and skips a falsy one", () => {
    const template = "{{#has_pass_qr}}con QR{{/has_pass_qr}}{{^has_pass_qr}}sin QR{{/has_pass_qr}}";
    expect(renderTemplate(template, { has_pass_qr: true }, { html: true })).toBe("con QR");
    expect(renderTemplate(template, { has_pass_qr: false }, { html: true })).toBe("sin QR");
  });

  it("renders a non-empty text section as truthy and an empty one as falsy", () => {
    const template = "{{#staff_note}}{{staff_note}}{{/staff_note}}";
    expect(renderTemplate(template, { staff_note: "aviso" }, { html: true })).toBe("aviso");
    expect(renderTemplate(template, { staff_note: "" }, { html: true })).toBe("");
  });

  it("renders a list section once per item, scoping inner variables to the item", () => {
    const template = "<ul>{{#participants}}<li>{{name}}: {{modality_name}}</li>{{/participants}}</ul>";
    const out = renderTemplate(
      template,
      { participants: [{ name: "Ana", modality_name: "5K" }, { name: "Beto", modality_name: "10K" }] },
      { html: true },
    );
    expect(out).toBe("<ul><li>Ana: 5K</li><li>Beto: 10K</li></ul>");
  });

  it("never re-expands {{...}} contained inside a substituted value (single pass only)", () => {
    const out = renderTemplate("{{name}}", { name: "{{malicious}}" }, { html: false });
    expect(out).toBe("{{malicious}}");
  });

  it("throws on an unbalanced section", () => {
    expect(() => renderTemplate("{{#a}}x", {}, { html: true })).toThrow();
  });
});
