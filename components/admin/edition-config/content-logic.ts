import type { JsonObject } from "@/lib/shared/api-contract";
import { nextUid } from "@/components/admin/edition-config/form-field-logic";

/**
 * Pure logic of the Edition content-block screen (P3-E2, Master §51, SEC-061). A block is a typed payload: text is Markdown with no
 * HTML, no inline images and only https/mailto/tel/relative links; images are REFERENCES to an existing media asset of the Edition
 * (there is no upload API in this phase). Edge validation mirrors private.cfg_content_payload; the database stays the authority.
 */

export type BlockType = "RICH_TEXT" | "CUSTOM_SECTION" | "CALLOUT" | "IMAGE" | "GALLERY" | "FAQ" | "DOCUMENT_LINK" | "SPONSOR_GROUP";
export type BlockStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";
export type CalloutTone = "INFO" | "SUCCESS" | "WARNING" | "DANGER";

export const BLOCK_TYPE_OPTIONS: readonly { value: BlockType; label: string; hint: string }[] = [
  { value: "RICH_TEXT", label: "Texto", hint: "Descripción de la carrera. Con un texto publicado de 30 caracteres o más se cumple el requisito de descripción." },
  { value: "CUSTOM_SECTION", label: "Sección con título", hint: "Una sección de texto con su propio título." },
  { value: "CALLOUT", label: "Aviso destacado", hint: "Una nota breve resaltada (información, éxito, advertencia o peligro)." },
  { value: "FAQ", label: "Preguntas frecuentes", hint: "Lista de preguntas con su respuesta." },
  { value: "DOCUMENT_LINK", label: "Enlace a documento", hint: "Un enlace con etiqueta (reglamento, mapa, etc.)." },
  { value: "IMAGE", label: "Imagen (referencia)", hint: "Referencia a una imagen ya cargada para esta edición." },
  { value: "GALLERY", label: "Galería (referencias)", hint: "Varias imágenes ya cargadas para esta edición." },
  { value: "SPONSOR_GROUP", label: "Patrocinadores", hint: "Lista de patrocinadores con enlace e imagen opcional." },
];

export const BLOCK_TYPE_LABEL: Record<string, string> = Object.fromEntries(BLOCK_TYPE_OPTIONS.map((option) => [option.value, option.label]));

export const BLOCK_STATUS_LABEL: Record<BlockStatus, string> = { DRAFT: "Borrador", PUBLISHED: "Publicado", ARCHIVED: "Archivado" };

export const TONE_OPTIONS: readonly { value: CalloutTone; label: string }[] = [
  { value: "INFO", label: "Información" },
  { value: "SUCCESS", label: "Éxito" },
  { value: "WARNING", label: "Advertencia" },
  { value: "DANGER", label: "Peligro" },
];

export type ContentRow = {
  event_content_block_id: string;
  modality_id: string | null;
  block_type: BlockType;
  position: number;
  status: BlockStatus;
  payload: Record<string, unknown>;
};

export type ItemDraft = { uid: string; question: string; answer: string; media_id: string; caption: string };
export type SponsorDraft = { uid: string; name: string; url: string; media_id: string };

export type ContentDraft = {
  block_type: BlockType;
  status: BlockStatus;
  position: string;
  modality_id: string;
  title: string;
  markdown: string;
  tone: CalloutTone;
  caption: string;
  media_id: string;
  label: string;
  url: string;
  description: string;
  items: ItemDraft[];
  sponsors: SponsorDraft[];
};

export function newItem(): ItemDraft {
  return { uid: nextUid("i"), question: "", answer: "", media_id: "", caption: "" };
}
export function newSponsor(): SponsorDraft {
  return { uid: nextUid("s"), name: "", url: "", media_id: "" };
}

export function emptyContentDraft(type: BlockType = "RICH_TEXT"): ContentDraft {
  return {
    block_type: type,
    status: "DRAFT",
    position: "",
    modality_id: "",
    title: "",
    markdown: "",
    tone: "INFO",
    caption: "",
    media_id: "",
    label: "",
    url: "",
    description: "",
    items: [],
    sponsors: [],
  };
}

const str = (value: unknown): string => (typeof value === "string" ? value : "");

export function contentToDraft(row: ContentRow): ContentDraft {
  const payload = row.payload ?? {};
  const draft = emptyContentDraft(row.block_type);
  draft.status = row.status;
  draft.position = String(row.position);
  draft.modality_id = row.modality_id ?? "";
  draft.title = str(payload.title);
  draft.markdown = str(payload.markdown);
  draft.tone = (["INFO", "SUCCESS", "WARNING", "DANGER"] as const).find((tone) => tone === payload.tone) ?? "INFO";
  draft.caption = str(payload.caption);
  draft.media_id = str(payload.event_media_asset_id);
  draft.label = str(payload.label);
  draft.url = str(payload.url);
  draft.description = str(payload.description);
  if (Array.isArray(payload.items)) {
    draft.items = payload.items
      .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
      .map((entry) => ({
        uid: nextUid("i"),
        question: str(entry.question),
        answer: str(entry.answer_markdown),
        media_id: str(entry.event_media_asset_id),
        caption: str(entry.caption),
      }));
  }
  if (Array.isArray(payload.sponsors)) {
    draft.sponsors = payload.sponsors
      .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
      .map((entry) => ({ uid: nextUid("s"), name: str(entry.name), url: str(entry.url), media_id: str(entry.event_media_asset_id) }));
  }
  return draft;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_LINK = /^(https:\/\/[^\s<>"\\]+|mailto:[^\s<>"\\]+|tel:\+?[0-9() .-]{3,32}|#[A-Za-z0-9_-]*|\/([^/\\&\s<>"][^\\&\s<>"]*)?)$/i;

export function isAllowedLink(url: string): boolean {
  return ALLOWED_LINK.test(url);
}

/** The reason code the server would answer for a Markdown text (private.cfg_markdown_error), or null when it is accepted. */
export function markdownError(text: string): "html_not_allowed" | "markdown_images_not_allowed" | "link_scheme_not_allowed" | null {
  if (/<[A-Za-z/!?]/.test(text)) return "html_not_allowed";
  if (/!\[/.test(text)) return "markdown_images_not_allowed";
  const destinations = [...text.matchAll(/\]\(\s*(<[^>]*>|[^\s)]*)/g), ...text.matchAll(/(?:^|\n) {0,3}\[[^\]\n]+\]:[ \t]*(<[^>]*>|\S+)/g)].map((match) =>
    match[1].replace(/^[<> ]+|[<> ]+$/g, ""),
  );
  return destinations.every(isAllowedLink) ? null : "link_scheme_not_allowed";
}

const MARKDOWN_MESSAGE: Record<string, string> = {
  html_not_allowed: "No se permite HTML. Escribe texto simple con formato Markdown.",
  markdown_images_not_allowed: "No se permiten imágenes dentro del texto. Usa un bloque de imagen.",
  link_scheme_not_allowed: "Los enlaces deben ser https, mailto, tel o una ruta relativa.",
};

export type ContentErrors = Partial<Record<string, string>>;

export function validateContent(draft: ContentDraft): ContentErrors {
  const errors: ContentErrors = {};
  const need = (name: string, value: string, max: number, required = true) => {
    const text = value.trim();
    if (required && !text) errors[name] = "Este campo es obligatorio.";
    else if (text.length > max) errors[name] = `Máximo ${max} caracteres.`;
  };
  const markdown = (name: string, value: string, max: number) => {
    need(name, value, max);
    if (!errors[name]) {
      const problem = markdownError(value);
      if (problem) errors[name] = MARKDOWN_MESSAGE[problem];
    }
  };
  const media = (name: string, value: string, required: boolean) => {
    if (value.trim() === "") {
      if (required) errors[name] = "Indica la referencia del recurso multimedia.";
    } else if (!UUID.test(value.trim())) errors[name] = "La referencia debe ser un identificador (UUID) de un recurso de esta edición.";
  };

  if (draft.position.trim() !== "" && !/^\d{1,5}$/.test(draft.position.trim())) errors.position = "Número entero, 0 o mayor.";

  switch (draft.block_type) {
    case "RICH_TEXT":
      need("title", draft.title, 160, false);
      markdown("markdown", draft.markdown, 20000);
      break;
    case "CUSTOM_SECTION":
      need("title", draft.title, 160);
      markdown("markdown", draft.markdown, 20000);
      break;
    case "CALLOUT":
      need("title", draft.title, 160, false);
      markdown("markdown", draft.markdown, 2000);
      break;
    case "IMAGE":
      media("media_id", draft.media_id, true);
      need("caption", draft.caption, 300, false);
      break;
    case "GALLERY":
      need("title", draft.title, 160, false);
      if (draft.items.length < 1 || draft.items.length > 30) errors.items = "Agrega de 1 a 30 imágenes.";
      for (const item of draft.items) {
        media(`item:${item.uid}:media_id`, item.media_id, true);
        need(`item:${item.uid}:caption`, item.caption, 300, false);
      }
      break;
    case "FAQ":
      need("title", draft.title, 160, false);
      if (draft.items.length < 1 || draft.items.length > 50) errors.items = "Agrega de 1 a 50 preguntas.";
      for (const item of draft.items) {
        need(`item:${item.uid}:question`, item.question, 300);
        markdown(`item:${item.uid}:answer`, item.answer, 5000);
      }
      break;
    case "DOCUMENT_LINK":
      need("label", draft.label, 160);
      need("url", draft.url, 2000);
      if (!errors.url && !isAllowedLink(draft.url.trim())) errors.url = MARKDOWN_MESSAGE.link_scheme_not_allowed;
      need("description", draft.description, 300, false);
      break;
    case "SPONSOR_GROUP":
      need("title", draft.title, 160, false);
      if (draft.sponsors.length < 1 || draft.sponsors.length > 50) errors.sponsors = "Agrega de 1 a 50 patrocinadores.";
      for (const sponsor of draft.sponsors) {
        need(`sponsor:${sponsor.uid}:name`, sponsor.name, 120);
        if (sponsor.url.trim() && !/^https:\/\/[^\s<>"\\]+$/i.test(sponsor.url.trim())) errors[`sponsor:${sponsor.uid}:url`] = "El enlace del patrocinador debe ser https.";
        media(`sponsor:${sponsor.uid}:media_id`, sponsor.media_id, false);
      }
      break;
  }
  return errors;
}

/** The `payload` the API stores for the block (private.cfg_content_payload shape). */
export function buildPayload(draft: ContentDraft): JsonObject {
  const optional = (target: JsonObject, key: string, value: string) => {
    if (value.trim()) target[key] = value.trim();
  };
  const payload: JsonObject = {};
  switch (draft.block_type) {
    case "RICH_TEXT":
    case "CUSTOM_SECTION":
      optional(payload, "title", draft.title);
      payload.markdown = draft.markdown.trim();
      break;
    case "CALLOUT":
      payload.tone = draft.tone;
      optional(payload, "title", draft.title);
      payload.markdown = draft.markdown.trim();
      break;
    case "IMAGE":
      payload.event_media_asset_id = draft.media_id.trim();
      optional(payload, "caption", draft.caption);
      break;
    case "GALLERY":
      optional(payload, "title", draft.title);
      payload.items = draft.items.map((item) => {
        const entry: JsonObject = { event_media_asset_id: item.media_id.trim() };
        optional(entry, "caption", item.caption);
        return entry;
      });
      break;
    case "FAQ":
      optional(payload, "title", draft.title);
      payload.items = draft.items.map((item) => ({ question: item.question.trim(), answer_markdown: item.answer.trim() }));
      break;
    case "DOCUMENT_LINK":
      payload.label = draft.label.trim();
      payload.url = draft.url.trim();
      optional(payload, "description", draft.description);
      break;
    case "SPONSOR_GROUP":
      optional(payload, "title", draft.title);
      payload.sponsors = draft.sponsors.map((sponsor) => {
        const entry: JsonObject = { name: sponsor.name.trim() };
        optional(entry, "url", sponsor.url);
        optional(entry, "event_media_asset_id", sponsor.media_id);
        return entry;
      });
      break;
  }
  return payload;
}

export function buildContentBody(draft: ContentDraft): JsonObject {
  const body: JsonObject = { block_type: draft.block_type, status: draft.status, payload: buildPayload(draft) };
  if (draft.position.trim()) body.position = Number(draft.position);
  if (draft.modality_id) body.modality_id = draft.modality_id;
  return body;
}

/** PATCH body: only what changed. `modality_id: null` is accepted by the API, so a block can be widened back to the whole edition. */
export function buildContentPatch(initial: ContentDraft, draft: ContentDraft): JsonObject | null {
  const patch: JsonObject = {};
  if (draft.status !== initial.status) patch.status = draft.status;
  if (draft.position.trim() !== initial.position.trim() && draft.position.trim()) patch.position = Number(draft.position);
  if (draft.modality_id !== initial.modality_id) patch.modality_id = draft.modality_id || null;
  if (JSON.stringify(buildPayload(draft)) !== JSON.stringify(buildPayload(initial))) patch.payload = buildPayload(draft);
  return Object.keys(patch).length > 0 ? patch : null;
}

/** One line for the list: the title, or the start of the text, or the link label. */
export function summarizeBlock(row: Pick<ContentRow, "block_type" | "payload">): string {
  const payload = row.payload ?? {};
  const count = (list: unknown, one: string, many: string) => {
    const n = Array.isArray(list) ? list.length : 0;
    return `${n} ${n === 1 ? one : many}`;
  };
  const clip = (text: string) => (text.length > 110 ? `${text.slice(0, 107)}…` : text);
  const title = str(payload.title).trim();
  switch (row.block_type) {
    case "RICH_TEXT":
    case "CUSTOM_SECTION":
    case "CALLOUT":
      return clip(title || str(payload.markdown).replace(/\s+/g, " ").trim()) || "Sin texto";
    case "DOCUMENT_LINK":
      return clip(str(payload.label)) || "Sin etiqueta";
    case "IMAGE":
      return clip(str(payload.caption)) || "Imagen sin leyenda";
    case "GALLERY":
      return `${title ? `${title} · ` : ""}${count(payload.items, "imagen", "imágenes")}`;
    case "FAQ":
      return `${title ? `${title} · ` : ""}${count(payload.items, "pregunta", "preguntas")}`;
    case "SPONSOR_GROUP":
      return `${title ? `${title} · ` : ""}${count(payload.sponsors, "patrocinador", "patrocinadores")}`;
  }
}

/** Blocks in display order: position, then creation order is already the array order from the server. */
export function sortBlocks<T extends { position: number }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => a.position - b.position);
}
