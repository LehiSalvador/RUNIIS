import React from "react";

const LESS_THAN_ESCAPE = String.raw`<`;

/** `<script type="application/ld+json">` payload: React does not entity-escape script text, and
 * escaping `<` keeps any `</script>` inside editor-provided strings inert (SEC-060). */
export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, LESS_THAN_ESCAPE);
}

/** Structured data as a text child, never via raw-HTML injection (eslint react/no-danger). */
export function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json">{serializeJsonLd(data)}</script>;
}
