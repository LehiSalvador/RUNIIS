import { describe, expect, it } from "vitest";
import { summarizeCspReport } from "@/app/api/csp-report/route";

describe("summarizeCspReport (F7/SEC-060)", () => {
  it("extracts scalar fields from a legacy report-uri body", () => {
    const body = JSON.stringify({
      "csp-report": {
        "document-uri": "https://runiis.mx/eventos/demo",
        "violated-directive": "script-src-elem",
        "blocked-uri": "https://evil.example/x.js",
        disposition: "enforce",
        "line-number": 42,
      },
    });
    expect(summarizeCspReport(body)).toEqual({
      disposition: "enforce",
      blocked_uri: "https://evil.example/x.js",
      violated_directive: "script-src-elem",
      document_uri: "https://runiis.mx/eventos/demo",
      line_number: 42,
    });
  });

  it("extracts scalar fields from a Reporting API (report-to) body", () => {
    const body = JSON.stringify([
      {
        type: "csp-violation",
        body: { documentURL: "ignored", url: "https://runiis.mx/cuenta", effectiveDirective: "script-src", blockedURL: "inline", disposition: "report", lineNumber: 7 },
      },
    ]);
    expect(summarizeCspReport(body)).toEqual({
      disposition: "report",
      blocked_uri: "inline",
      violated_directive: "script-src",
      document_uri: "https://runiis.mx/cuenta",
      line_number: 7,
    });
  });

  it("returns null for invalid JSON or an unrecognised shape", () => {
    expect(summarizeCspReport("not json")).toBeNull();
    expect(summarizeCspReport(JSON.stringify({ unrelated: true }))).toBeNull();
    expect(summarizeCspReport(JSON.stringify([{ type: "not-csp" }]))).toBeNull();
  });

  it("truncates long field values instead of logging the full body", () => {
    const longUri = "https://evil.example/" + "x".repeat(1000);
    const body = JSON.stringify({ "csp-report": { "blocked-uri": longUri } });
    const summary = summarizeCspReport(body);
    expect((summary?.blocked_uri as string).length).toBeLessThanOrEqual(300);
  });

  it("never throws on malformed nested shapes", () => {
    expect(() => summarizeCspReport(JSON.stringify({ "csp-report": null }))).not.toThrow();
    expect(summarizeCspReport(JSON.stringify({ "csp-report": null }))).toBeNull();
  });
});
