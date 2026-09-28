import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { getClientIp } from "@/lib/server/http/client-ip";
import { consumeInfraRateLimit } from "@/lib/server/http/rate-limit";
import { readBodyWithCap } from "@/lib/server/http/read-body";
import { logEvent } from "@/lib/server/log";

// POST /api/csp-report (F7/SEC-060): the CSP `report-to`/`report-uri` target declared in proxy.ts.
// Browsers send either the legacy report-uri body ({"csp-report": {...}}, content-type
// application/csp-report) or a CSP3 Reporting API body (an array of report objects, content-type
// application/reports+json). This is never part of the {data,meta}/{error} envelope: the browser
// does not read the response, so a malformed or hostile body is always a plain 204, never a
// surfaced application error. Rate-limited per IP and size-capped so it cannot become a
// log-flooding or storage vector. Only scalar fields are logged, never the raw body (no PII, no
// secrets -- CSP reports can carry query strings, which is exactly why this stays scalar/truncated).
const MAX_BODY_BYTES = 8 * 1024;
const MAX_FIELD_LENGTH = 300;

function noContent(): Response {
  return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}

async function allowCspReport(clientIp: string): Promise<boolean> {
  try {
    await consumeInfraRateLimit("csp_report.ip", clientIp);
    return true;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    if (!(await allowCspReport(getClientIp(request)))) return noContent();

    // Capped while streaming (not only against Content-Length, which can be absent or wrong) so an
    // oversized or length-lying report is never fully buffered into memory.
    const text = await readBodyWithCap(request, MAX_BODY_BYTES);
    if (text === null) return noContent();

    const summary = summarizeCspReport(text);
    if (summary) logEvent("warn", "csp_violation", summary);
  } catch {
    // A malformed or unreadable report is never a caller-visible error.
  }
  return noContent();
}

type ScalarSummary = Record<string, string | number>;

/** Extracts a handful of scalar, truncated fields from either report body shape. Returns null for
 * anything that does not parse as one of the two known shapes (still answered with 204). */
export function summarizeCspReport(rawBody: string): ScalarSummary | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return null;
  }
  const report = extractReport(parsed);
  if (!report) return null;

  return {
    disposition: truncate(pickString(report, ["disposition"])),
    blocked_uri: truncate(pickString(report, ["blocked-uri", "blockedURL"])),
    violated_directive: truncate(pickString(report, ["violated-directive", "effectiveDirective"])),
    document_uri: truncate(pickString(report, ["document-uri", "url"])),
    line_number: pickNumber(report, ["line-number", "lineNumber"]),
  };
}

function extractReport(parsed: unknown): Record<string, unknown> | null {
  if (isRecord(parsed) && isRecord(parsed["csp-report"])) return parsed["csp-report"];
  if (Array.isArray(parsed)) {
    const first = parsed.find((entry) => isRecord(entry) && entry.type === "csp-violation");
    if (isRecord(first) && isRecord(first.body)) return first.body;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function pickString(report: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = report[key];
    if (typeof value === "string") return value;
  }
  return "";
}

function pickNumber(report: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const value = report[key];
    if (typeof value === "number") return value;
  }
  return 0;
}

function truncate(value: string): string {
  return value.slice(0, MAX_FIELD_LENGTH);
}
