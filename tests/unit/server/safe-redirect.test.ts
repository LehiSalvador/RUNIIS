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

  // P2-AC-10.a: /inscripcion/[slug] sends anonymous or expired sessions to /entrar?next=/inscripcion/{slug}
  // (and incomplete profiles to /onboarding); the registration flow must resume there after sign-in.
  describe("registration resume path", () => {
    const slug160 = "a".repeat(160);
    const BS = String.fromCharCode(92); // a literal backslash

    it("accepts exactly /inscripcion/{slug} with a canonical edition slug, raw or URL-encoded", () => {
      expect(resolveNextPath("/inscripcion/qa-p2-gratis")).toBe("/inscripcion/qa-p2-gratis");
      expect(resolveNextPath("/inscripcion/5k")).toBe("/inscripcion/5k");
      expect(resolveNextPath(encodeURIComponent("/inscripcion/qa-p2-whatsapp"))).toBe("/inscripcion/qa-p2-whatsapp");
      expect(resolveNextPath(`/inscripcion/${slug160}`)).toBe(`/inscripcion/${slug160}`);
    });

    it("rejects a missing, non-canonical or oversized slug", () => {
      for (const raw of [
        "/inscripcion",
        "/inscripcion/",
        "/inscripcion//",
        "/inscripcion/Qa-P2",
        "/inscripcion/-qa",
        "/inscripcion/qa-",
        "/inscripcion/qa--p2",
        "/inscripcion/qa_p2",
        "/inscripcion/qa p2",
        "/inscripcion/qa.p2",
        `/inscripcion/${slug160}a`,
      ]) {
        expect(resolveNextPath(raw), raw).toBe("/cuenta");
      }
    });

    it("rejects extra segments, queries, fragments, control characters and encoded traversal under /inscripcion", () => {
      for (const raw of [
        "/inscripcion/qa-p2/extra",
        "/inscripcion/qa-p2/",
        "/inscripcion/qa-p2?next=//evil.example",
        "/inscripcion/qa-p2#frag",
        "/inscripcion/..",
        "/inscripcion/../cuenta",
        "/inscripcion/%2e%2e/cuenta",
        "/inscripcion/qa-p2/..%2f..%2fadmin",
        "/inscripcion/qa-p2%2f..%2f..%2fevil",
        "/inscripcion/qa-p2%00",
        "/inscripcion/qa-p2%0d%0aSet-Cookie:x=1",
        `/inscripcion/qa-p2${BS}evil.example`,
      ]) {
        expect(resolveNextPath(raw), raw).toBe("/cuenta");
        expect(resolveNextPath(encodeURIComponent(raw)), `encoded ${raw}`).toBe("/cuenta");
      }
    });

    it("does not let the new prefix reopen the open-redirect vectors", () => {
      for (const raw of [
        "//inscripcion/qa-p2",
        `/${BS}inscripcion/qa-p2`,
        "https://evil.example/inscripcion/qa-p2",
        "javascript:/inscripcion/qa-p2",
        "inscripcion/qa-p2",
      ]) {
        expect(resolveNextPath(raw), raw).toBe("/cuenta");
      }
      // Decoded once only: a double-encoded value stays inert text, never a different route.
      expect(resolveNextPath(encodeURIComponent(encodeURIComponent("/inscripcion/qa-p2")))).toBe("/cuenta");
    });

    it("keeps lookalike prefixes and the previously allowed ones as before", () => {
      expect(resolveNextPath("/inscripcionx/qa-p2")).toBe("/cuenta");
      expect(resolveNextPath("/cuenta/pases")).toBe("/cuenta/pases");
    });
  });
});
