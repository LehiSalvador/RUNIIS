import { describe, expect, test } from "vitest";
import {
  buildContentBody,
  buildContentPatch,
  buildPayload,
  contentToDraft,
  emptyContentDraft,
  isAllowedLink,
  markdownError,
  newItem,
  newSponsor,
  sortBlocks,
  summarizeBlock,
  validateContent,
  type ContentDraft,
  type ContentRow,
} from "@/components/admin/edition-config/content-logic";

const MEDIA = "6a1f0d52-9f0e-4b88-bd3c-7f4e4d0a1c11";

function draft(patch: Partial<ContentDraft>): ContentDraft {
  return { ...emptyContentDraft(), ...patch };
}

describe("markdown rules (SEC-061)", () => {
  test("no HTML, no inline images, only https/mailto/tel/relative links", () => {
    expect(markdownError("Una **carrera** para [todos](https://runiis.example/info).")).toBeNull();
    expect(markdownError("Escribe a [nosotros](mailto:hola@runiis.example) o al [mapa](/eventos).")).toBeNull();
    expect(markdownError("<b>hola</b>")).toBe("html_not_allowed");
    expect(markdownError("<script>alert(1)</script>")).toBe("html_not_allowed");
    expect(markdownError("![logo](https://x.example/a.png)")).toBe("markdown_images_not_allowed");
    expect(markdownError("[malo](javascript:alert(1))")).toBe("link_scheme_not_allowed");
    expect(markdownError("[malo](http://inseguro.example)")).toBe("link_scheme_not_allowed");
    expect(markdownError("[malo](//otro.example)")).toBe("link_scheme_not_allowed");
    expect(markdownError("[ref]\n\n[ref]: data:text/html;base64,AAA")).not.toBeNull();
  });

  test("the link allow-list", () => {
    for (const ok of ["https://a.example/x?y=1", "mailto:a@b.example", "tel:+528110814941", "#info", "/eventos/carrera"]) expect(isAllowedLink(ok), ok).toBe(true);
    for (const bad of ["http://a.example", "javascript:alert(1)", "//a.example", "ftp://a.example", "data:text/html,x", ""]) expect(isAllowedLink(bad), bad).toBe(false);
  });
});

describe("validation by block type", () => {
  test("a text block needs text; a section also needs its title", () => {
    expect(validateContent(draft({ block_type: "RICH_TEXT" })).markdown).toBeDefined();
    expect(validateContent(draft({ block_type: "RICH_TEXT", markdown: "Hola a todos los corredores." }))).toEqual({});
    expect(validateContent(draft({ block_type: "CUSTOM_SECTION", markdown: "Texto" })).title).toBeDefined();
    expect(validateContent(draft({ block_type: "RICH_TEXT", markdown: "<i>x</i>" })).markdown).toContain("HTML");
    expect(validateContent(draft({ block_type: "CALLOUT", markdown: "x".repeat(2001) })).markdown).toContain("2000");
  });

  test("an image is a reference to an existing asset, never an upload or a URL", () => {
    expect(validateContent(draft({ block_type: "IMAGE" })).media_id).toBeDefined();
    expect(validateContent(draft({ block_type: "IMAGE", media_id: "https://x.example/a.png" })).media_id).toContain("identificador");
    expect(validateContent(draft({ block_type: "IMAGE", media_id: MEDIA }))).toEqual({});
  });

  test("lists need between one and the maximum entries, each complete", () => {
    expect(validateContent(draft({ block_type: "FAQ", items: [] })).items).toBeDefined();
    const faq = newItem();
    const errors = validateContent(draft({ block_type: "FAQ", items: [faq] }));
    expect(errors[`item:${faq.uid}:question`]).toBeDefined();
    expect(errors[`item:${faq.uid}:answer`]).toBeDefined();
    expect(validateContent(draft({ block_type: "FAQ", items: [{ ...faq, question: "¿Hay regaderas?", answer: "Sí, en la meta." }] }))).toEqual({});

    const gallery = newItem();
    expect(validateContent(draft({ block_type: "GALLERY", items: [{ ...gallery, media_id: "nope" }] }))[`item:${gallery.uid}:media_id`]).toBeDefined();

    const sponsor = newSponsor();
    const sponsorErrors = validateContent(draft({ block_type: "SPONSOR_GROUP", sponsors: [{ ...sponsor, url: "http://a.example", media_id: "x" }] }));
    expect(sponsorErrors[`sponsor:${sponsor.uid}:name`]).toBeDefined();
    expect(sponsorErrors[`sponsor:${sponsor.uid}:url`]).toContain("https");
    expect(sponsorErrors[`sponsor:${sponsor.uid}:media_id`]).toBeDefined();
    expect(validateContent(draft({ block_type: "SPONSOR_GROUP", sponsors: [{ ...sponsor, name: "Casa Mayor", url: "https://casa.example" }] }))).toEqual({});
  });

  test("a document link needs a label and an allowed address", () => {
    expect(validateContent(draft({ block_type: "DOCUMENT_LINK", label: "Reglamento", url: "http://x.example" })).url).toContain("https");
    expect(validateContent(draft({ block_type: "DOCUMENT_LINK", label: "Reglamento", url: "https://x.example/reglamento.pdf" }))).toEqual({});
    expect(validateContent(draft({ block_type: "DOCUMENT_LINK", url: "/legal/terminos" })).label).toBeDefined();
  });

  test("position is a small non-negative integer", () => {
    expect(validateContent(draft({ block_type: "RICH_TEXT", markdown: "Texto", position: "-1" })).position).toBeDefined();
    expect(validateContent(draft({ block_type: "RICH_TEXT", markdown: "Texto", position: "2" }))).toEqual({});
  });
});

describe("the payload the API stores", () => {
  test("each type produces exactly its own keys", () => {
    expect(buildPayload(draft({ block_type: "RICH_TEXT", title: " Sobre la carrera ", markdown: " Hola " }))).toEqual({ title: "Sobre la carrera", markdown: "Hola" });
    expect(buildPayload(draft({ block_type: "RICH_TEXT", markdown: "Hola" }))).toEqual({ markdown: "Hola" });
    expect(buildPayload(draft({ block_type: "CALLOUT", tone: "WARNING", markdown: "Cuidado" }))).toEqual({ tone: "WARNING", markdown: "Cuidado" });
    expect(buildPayload(draft({ block_type: "IMAGE", media_id: MEDIA, caption: "Meta" }))).toEqual({ event_media_asset_id: MEDIA, caption: "Meta" });
    expect(buildPayload(draft({ block_type: "DOCUMENT_LINK", label: "Reglamento", url: "/legal/terminos" }))).toEqual({ label: "Reglamento", url: "/legal/terminos" });
    expect(buildPayload(draft({ block_type: "FAQ", items: [{ ...newItem(), question: "¿Q?", answer: "A" }] }))).toEqual({ items: [{ question: "¿Q?", answer_markdown: "A" }] });
    expect(buildPayload(draft({ block_type: "GALLERY", items: [{ ...newItem(), media_id: MEDIA }] }))).toEqual({ items: [{ event_media_asset_id: MEDIA }] });
    expect(buildPayload(draft({ block_type: "SPONSOR_GROUP", sponsors: [{ ...newSponsor(), name: "Casa", url: "https://c.example", media_id: MEDIA }] }))).toEqual({
      sponsors: [{ name: "Casa", url: "https://c.example", event_media_asset_id: MEDIA }],
    });
  });

  test("create body: type, status, payload, and optional position and modality", () => {
    expect(buildContentBody(draft({ block_type: "RICH_TEXT", markdown: "Hola", status: "PUBLISHED" }))).toEqual({ block_type: "RICH_TEXT", status: "PUBLISHED", payload: { markdown: "Hola" } });
    expect(buildContentBody(draft({ block_type: "RICH_TEXT", markdown: "Hola", position: "3", modality_id: "m1" }))).toMatchObject({ position: 3, modality_id: "m1", status: "DRAFT" });
  });

  const row: ContentRow = {
    event_content_block_id: "b1",
    modality_id: "m1",
    block_type: "FAQ",
    position: 2,
    status: "PUBLISHED",
    payload: { title: "Dudas", items: [{ question: "¿Hay regaderas?", answer_markdown: "Sí" }] },
  };

  test("a stored block opens as the same draft and an edit sends only what changed", () => {
    const initial = contentToDraft(row);
    expect(initial.block_type).toBe("FAQ");
    expect(initial.items).toHaveLength(1);
    expect(buildPayload(initial)).toEqual(row.payload);
    expect(buildContentPatch(initial, initial)).toBeNull();
    expect(buildContentPatch(initial, { ...initial, status: "ARCHIVED" })).toEqual({ status: "ARCHIVED" });
    expect(buildContentPatch(initial, { ...initial, modality_id: "" })).toEqual({ modality_id: null });
    expect(buildContentPatch(initial, { ...initial, position: "5" })).toEqual({ position: 5 });
    const edited = { ...initial, items: [{ ...initial.items[0], answer: "Sí, y vestidores." }] };
    expect(buildContentPatch(initial, edited)).toEqual({ payload: { title: "Dudas", items: [{ question: "¿Hay regaderas?", answer_markdown: "Sí, y vestidores." }] } });
  });

  test("a payload from the server that is not what we expect never crashes the editor", () => {
    const odd = contentToDraft({ ...row, block_type: "GALLERY", payload: { items: "no" } });
    expect(odd.items).toEqual([]);
    expect(contentToDraft({ ...row, block_type: "CALLOUT", payload: { tone: "PURPLE", markdown: 5 } })).toMatchObject({ tone: "INFO", markdown: "" });
  });
});

describe("list display", () => {
  test("one line per block, whatever its type", () => {
    expect(summarizeBlock({ block_type: "RICH_TEXT", payload: { markdown: "Carrera urbana para toda la familia." } })).toBe("Carrera urbana para toda la familia.");
    expect(summarizeBlock({ block_type: "CUSTOM_SECTION", payload: { title: "Premiación", markdown: "x" } })).toBe("Premiación");
    expect(summarizeBlock({ block_type: "FAQ", payload: { title: "Dudas", items: [{}, {}] } })).toBe("Dudas · 2 preguntas");
    expect(summarizeBlock({ block_type: "GALLERY", payload: { items: [{}] } })).toBe("1 imagen");
    expect(summarizeBlock({ block_type: "DOCUMENT_LINK", payload: { label: "Reglamento" } })).toBe("Reglamento");
    expect(summarizeBlock({ block_type: "RICH_TEXT", payload: { markdown: "x".repeat(300) } }).length).toBeLessThanOrEqual(110);
    expect(summarizeBlock({ block_type: "RICH_TEXT", payload: {} })).toBe("Sin texto");
  });

  test("blocks are shown by position without mutating the input", () => {
    const input = [{ position: 3 }, { position: 1 }, { position: 2 }];
    expect(sortBlocks(input).map((entry) => entry.position)).toEqual([1, 2, 3]);
    expect(input.map((entry) => entry.position)).toEqual([3, 1, 2]);
  });
});
