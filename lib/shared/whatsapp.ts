// Master §68 WhatsApp handoff. The URL carries only the Edition name and the public reference:
// never participant data (DOB, phones, emergency contacts, guardian, email).
const E164 = /^\+[1-9][0-9]{7,14}$/;
const PUBLIC_REFERENCE = /^R-[0-9A-Z]{4}-[0-9A-Z]{4}$/;
const MAX_EDITION_NAME = 120;

export type WhatsAppHandoff = { phoneE164: string; editionName: string; publicReference: string };

export function whatsAppMessage({ editionName, publicReference }: Omit<WhatsAppHandoff, "phoneE164">): string {
  const name = editionName.replace(/\s+/g, " ").trim().slice(0, MAX_EDITION_NAME);
  return `Hola. Quiero completar mi inscripción a ${name}. Referencia: ${publicReference}.`;
}

/** `https://wa.me/<digits>?text=<message>`; throws on a malformed number or reference. */
export function buildWhatsAppUrl(handoff: WhatsAppHandoff): string {
  if (!E164.test(handoff.phoneE164)) throw new Error("Invalid WhatsApp phone number");
  if (!PUBLIC_REFERENCE.test(handoff.publicReference)) throw new Error("Invalid public reference");
  if (handoff.editionName.trim() === "") throw new Error("Missing Edition name");
  return `https://wa.me/${handoff.phoneE164.slice(1)}?text=${encodeURIComponent(whatsAppMessage(handoff))}`;
}
