import { describe, expect, it } from "vitest";
import { buildWhatsAppUrl, whatsAppMessage } from "@/lib/shared/whatsapp";

// Master §68: the WhatsApp handoff link a PENDING_CONFIRMATION EXTERNAL_WHATSAPP request carries.
// Participant data (DOB, phones, emergency contact, guardian, email) must never reach this URL.
describe("whatsapp handoff", () => {
  it("builds a wa.me link from the E.164 number, with the message URL-encoded", () => {
    const url = buildWhatsAppUrl({ phoneE164: "+528110009999", editionName: "Carrera RUNIIS 10K", publicReference: "R-AB12-CD34" });
    expect(url.startsWith("https://wa.me/528110009999?text=")).toBe(true);
    const decoded = decodeURIComponent(new URL(url).search.slice("?text=".length));
    expect(decoded).toBe("Hola. Quiero completar mi inscripción a Carrera RUNIIS 10K. Referencia: R-AB12-CD34.");
  });

  it("collapses whitespace and truncates an overlong Edition name, never the reference", () => {
    const message = whatsAppMessage({ editionName: `  Carrera   ${"X".repeat(200)}  `, publicReference: "R-AB12-CD34" });
    expect(message).toContain("Referencia: R-AB12-CD34.");
    expect(message.length).toBeLessThan(200);
  });

  it("rejects a malformed phone number", () => {
    expect(() => buildWhatsAppUrl({ phoneE164: "528110009999", editionName: "Carrera", publicReference: "R-AB12-CD34" })).toThrow();
    expect(() => buildWhatsAppUrl({ phoneE164: "not-a-phone", editionName: "Carrera", publicReference: "R-AB12-CD34" })).toThrow();
  });

  it("rejects a malformed public reference (never leaks an internal id format instead)", () => {
    expect(() => buildWhatsAppUrl({ phoneE164: "+528110009999", editionName: "Carrera", publicReference: "not-a-reference" })).toThrow();
  });

  it("rejects an empty Edition name", () => {
    expect(() => buildWhatsAppUrl({ phoneE164: "+528110009999", editionName: "   ", publicReference: "R-AB12-CD34" })).toThrow();
  });
});
