/**
 * A staff label next to the opaque tail of the staff id (P3SECA-11): a label comes from a self-declared name, so two people can carry
 * the same or an imitating one; the id tail lets an auditor tell them apart. Pass the label and the id the server returned together
 * (`<x>_staff_label` + `<x>_staff_id`); never invent an id. The tail is the last 6 hex digits of the uuid, never the whole id.
 */
export function staffIdSuffix(staffId: string | null | undefined): string | null {
  if (!staffId) return null;
  const hex = staffId.replace(/[^0-9a-fA-F]/g, "");
  return hex.length >= 6 ? hex.slice(-6).toLowerCase() : null;
}

/** "Ana R. · #1a2b3c"; without an id the label alone; without a label nothing (the caller shows its own empty state). */
export function formatStaffLabel(label: string | null | undefined, staffId: string | null | undefined): string | null {
  const text = label?.trim();
  if (!text) return null;
  const suffix = staffIdSuffix(staffId);
  return suffix ? `${text} · #${suffix}` : text;
}
