import React from "react";

// F8/SEC-061: real JSON-unicode escapes (literal `\uXXXX` source text in the output, not the actual
// character), so this is inert wherever the string ends up, not only when React happens to rewrite
// `<script`/`</script` in a script child. U+2028/U+2029 are also escaped: they are valid inside a
// JSON string but are line terminators in a `<script>` body, which some older UAs mishandle.
const JSON_LD_ESCAPES: Record<string, string> = {
  "<": "\\u003c",
  ">": "\\u003e",
  "&": "\\u0026",
  "\u2028": "\\u2028",
  "\u2029": "\\u2029",
};
const JSON_LD_UNSAFE_CHARS = /[<>&\u2028\u2029]/g;

/** `<script type="application/ld+json">` payload, safe to embed verbatim (SEC-060/SEC-061). */
export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(JSON_LD_UNSAFE_CHARS, (ch) => JSON_LD_ESCAPES[ch]);
}

/** Structured data as a text child, never via raw-HTML injection (eslint react/no-danger). */
export function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json">{serializeJsonLd(data)}</script>;
}
