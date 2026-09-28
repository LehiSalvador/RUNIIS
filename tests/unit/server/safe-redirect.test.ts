import { describe, expect, it } from "vitest";
import { resolveNextPath } from "@/lib/server/auth/safe-redirect";

// SEC-044: the OAuth callback's `next` is attacker-controlled query input. Every accepted value
// must stay an internal path; anything that could become an off-site or scheme-relative redirect
// falls back to the default.
describe("resolveNextPath", () => {
  it("accepts allowed internal top-level paths", () => {
    expect(resolveNextPath("/cuenta")).toBe("/cuenta");
    expect(resolveNextPath("/cuenta/pases")).toBe("/cuenta/pases");
    expect(resolveNextPath("/admin/staff")).toBe("/admin/staff");
    expect(resolveNextPath("/scanner")).toBe("/scanner");
    expect(resolveNextPath("/")).toBe("/");
  });

  it("defaults when absent or empty", () => {
    expect(resolveNextPath(null)).toBe("/cuenta");
    expect(resolveNextPath("")).toBe("/cuenta");
  });

  it("rejects an unknown top-level segment", () => {
    expect(resolveNextPath("/not-a-real-route")).toBe("/cuenta");
  });

  it("rejects protocol-relative and backslash variants (open redirect)", () => {
    expect(resolveNextPath("//evil.example")).toBe("/cuenta");
    expect(resolveNextPath("/\\evil.example")).toBe("/cuenta");
    expect(resolveNextPath("\\\\evil.example")).toBe("/cuenta");
  });

  it("rejects an absolute URL with a scheme, even URL-encoded", () => {
    expect(resolveNextPath("https://evil.example")).toBe("/cuenta");
    expect(resolveNextPath("javascript:alert(1)")).toBe("/cuenta");
    expect(resolveNextPath(encodeURIComponent("https://evil.example"))).toBe("/cuenta");
  });

  it("rejects a value that does not start with a single slash", () => {
    expect(resolveNextPath("cuenta")).toBe("/cuenta");
    expect(resolveNextPath("evil.example/cuenta")).toBe("/cuenta");
  });

  it("falls back on a malformed percent-encoding instead of throwing", () => {
    expect(resolveNextPath("%")).toBe("/cuenta");
  });
});
