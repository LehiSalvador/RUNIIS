import "server-only";
import type { JsonObject } from "@/lib/shared/api-contract";

// Logic-less template syntax (Master §132/§133, SEC-081): `{{var}}` (always escaped in HTML output),
// `{{#var}}...{{/var}}` (flag true / non-empty text / non-empty list — renders once per item for a
// list), `{{^var}}...{{/var}}` (inverted). No nested nested-tag lookups, no arbitrary expressions: the
// DB is the only source of executable-looking content and this engine never evaluates it as code.

export type TemplateVariableDef = {
  type: "text" | "multiline" | "path" | "url" | "flag" | "list";
  max?: number;
  optional?: boolean;
  source?: "snapshot" | "campaign" | "system";
  fields?: Record<string, { type: string; max?: number }>;
};
export type TemplateVariableSchema = { variables: Record<string, TemplateVariableDef> };

export type ResolvedScalar = string | boolean;
export type ResolvedListItem = Record<string, string>;
export type ResolvedVars = Record<string, ResolvedScalar | ResolvedListItem[]>;

class TemplateVariableError extends Error {
  constructor(readonly field: string, message: string) {
    super(message);
    this.name = "TemplateVariableError";
  }
}

/**
 * Turns the template's declared variables into display-ready values: `path` becomes an absolute
 * `APP_BASE_URL` link (A9: links only ever point at our own base URL, never a stored/foreign host),
 * `url` values are already-absolute system-built links and are checked against the same origin,
 * `flag` becomes a boolean, `list` becomes an array of resolved field records. Missing required
 * (non-optional) values are a programming error, not a template issue — the DB already enforces
 * their presence for snapshot/campaign variables at enqueue time (`comms_enqueue_message`).
 */
export function resolveTemplateVariables(
  schema: TemplateVariableSchema,
  snapshotVars: JsonObject,
  systemVars: JsonObject,
  appBaseUrl: string,
): ResolvedVars {
  const origin = new URL(appBaseUrl).origin;
  const resolved: ResolvedVars = {};
  for (const [name, def] of Object.entries(schema.variables)) {
    const raw = def.source === "system" ? systemVars[name] : snapshotVars[name];
    if (raw === undefined || raw === null) {
      if (def.optional) {
        resolved[name] = def.type === "flag" ? false : def.type === "list" ? [] : "";
        continue;
      }
      throw new TemplateVariableError(name, "missing required template variable");
    }
    resolved[name] = resolveOne(name, def, raw, origin, appBaseUrl);
  }
  return resolved;
}

function resolveOne(name: string, def: TemplateVariableDef, raw: unknown, origin: string, appBaseUrl: string): ResolvedScalar | ResolvedListItem[] {
  switch (def.type) {
    case "flag":
      return Boolean(raw);
    case "path": {
      const path = String(raw);
      if (!path.startsWith("/")) throw new TemplateVariableError(name, "path variable must be app-relative");
      return new URL(path, appBaseUrl).toString();
    }
    case "url": {
      const url = String(raw);
      if (new URL(url).origin !== origin) throw new TemplateVariableError(name, "url variable must be same-origin as APP_BASE_URL");
      return url;
    }
    case "list": {
      if (!Array.isArray(raw)) throw new TemplateVariableError(name, "list variable must be an array");
      const fields = def.fields ?? {};
      return raw.slice(0, def.max ?? raw.length).map((item) => {
        const record = item as JsonObject;
        const out: ResolvedListItem = {};
        for (const fieldName of Object.keys(fields)) out[fieldName] = truncate(String(record[fieldName] ?? ""), fields[fieldName]?.max);
        return out;
      });
    }
    default:
      return truncate(String(raw), def.max);
  }
}

function truncate(value: string, max: number | undefined): string {
  return max ? value.slice(0, max) : value;
}

const HTML_ESCAPE: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function escapeText(value: string, html: boolean): string {
  const collapsed = value.replace(/[\u0000-\u001f\u007f]+/g, " ");
  return html ? collapsed.replace(/[&<>"']/g, (ch) => HTML_ESCAPE[ch]) : collapsed;
}

type Node = { kind: "text"; value: string } | { kind: "var"; name: string } | { kind: "section"; name: string; invert: boolean; children: Node[] };

const TAG = /\{\{(#|\^|\/)?([a-z_]+)\}\}/g;

function parse(template: string): Node[] {
  const stack: { name: string; invert: boolean; children: Node[] }[] = [];
  let root: Node[] = [];
  let current = root;
  let lastIndex = 0;
  TAG.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TAG.exec(template))) {
    const [full, sigil, name] = match;
    if (match.index > lastIndex) current.push({ kind: "text", value: template.slice(lastIndex, match.index) });
    lastIndex = match.index + full.length;
    if (sigil === "#" || sigil === "^") {
      const frame = { name, invert: sigil === "^", children: [] as Node[] };
      stack.push(frame);
      current = frame.children;
    } else if (sigil === "/") {
      const frame = stack.pop();
      if (!frame || frame.name !== name) throw new TemplateVariableError(name, "unbalanced template section");
      current = stack.length > 0 ? stack[stack.length - 1].children : root;
      current.push({ kind: "section", name: frame.name, invert: frame.invert, children: frame.children });
    } else {
      current.push({ kind: "var", name });
    }
  }
  if (lastIndex < template.length) current.push({ kind: "text", value: template.slice(lastIndex) });
  if (stack.length > 0) throw new TemplateVariableError(stack[0].name, "unclosed template section");
  return root;
}

function renderNodes(nodes: Node[], scope: ResolvedVars, html: boolean): string {
  let out = "";
  for (const node of nodes) {
    if (node.kind === "text") {
      out += node.value;
    } else if (node.kind === "var") {
      const value = scope[node.name];
      out += escapeText(typeof value === "string" ? value : "", html);
    } else {
      const value = scope[node.name];
      const truthy = Array.isArray(value) ? value.length > 0 : typeof value === "boolean" ? value : Boolean(value && String(value).length > 0);
      if (node.invert ? !truthy : truthy) {
        if (Array.isArray(value)) {
          for (const item of value) out += renderNodes(node.children, { ...scope, ...item }, html);
        } else {
          out += renderNodes(node.children, scope, html);
        }
      }
    }
  }
  return out;
}

/** Renders one field (subject/html/text) against already-resolved, already-escaped-safe display vars. */
export function renderTemplate(template: string, vars: ResolvedVars, options: { html: boolean }): string {
  return renderNodes(parse(template), vars, options.html);
}
