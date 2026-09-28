import "server-only";
import type { NextRequest } from "next/server";

/**
 * Reads a request body with a hard byte cap enforced while streaming, not only against
 * `Content-Length` (which can be absent -- chunked transfer -- or simply wrong/spoofed). Aborts
 * the read and returns null the moment the running total exceeds `maxBytes`, so an oversized or
 * length-lying body is never fully buffered into memory. Same pattern as the Brevo webhook route's
 * `readBodyWithCap` (SEC-080), factored out here for the CSP report sink (F7).
 */
export async function readBodyWithCap(request: NextRequest, maxBytes: number): Promise<string | null> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > maxBytes) return null;
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks));
}
