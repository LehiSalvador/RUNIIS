import type { AdminNavKey } from "@/components/shell/admin-nav-items";

/**
 * Staff RBAC for the admin surface (Master §145, ux-spec RBAC boundary). Pure and client-safe so the
 * nav, the page guards and the unit tests share one table.
 *
 * Navigation hides what a role cannot use; hiding is NEVER the control. Every admin page re-resolves
 * the staff session on the server (app/admin/_lib/session.ts) and every API/DB command re-authorises.
 */
export type StaffRole = "ADMIN" | "OPERATOR" | "CHECKIN" | "MODERATOR";

export const STAFF_ROLE_ORDER: readonly StaffRole[] = ["ADMIN", "OPERATOR", "CHECKIN", "MODERATOR"];

export const STAFF_ROLE_LABEL: Record<StaffRole, string> = {
  ADMIN: "Administrador",
  OPERATOR: "Operador",
  CHECKIN: "Check-in",
  MODERATOR: "Moderador",
};

/** Mirror of `current_actor().staff_roles[]` (lib/server/auth/actor.ts). */
export type StaffAssignment = {
  role: StaffRole;
  scope_type: "GLOBAL" | "EDITION";
  edition_id: string | null;
};

/**
 * Which roles may open each admin section. Matrix (Master §145):
 * - ADMIN: everything (staff roles, settings, bans, closure/reopen, legal, campaigns, audit).
 * - OPERATOR: event content, requests, registrations/participants, kits, attendance, operational
 *   communications. No closure/reopen, no staff roles, no global settings, no audit.
 * - CHECKIN: scanner, minimal lookup, check-in, guardian verification only (the scanner is its own
 *   surface, not an admin section). It only sees the dashboard.
 * - MODERATOR: avatar queue and suspension workflow (community). No operational PII.
 */
export const NAV_ACCESS: Record<AdminNavKey, readonly StaffRole[]> = {
  dashboard: ["ADMIN", "OPERATOR", "CHECKIN", "MODERATOR"],
  tareas: ["ADMIN", "OPERATOR"],
  eventos: ["ADMIN", "OPERATOR"],
  solicitudes: ["ADMIN", "OPERATOR"],
  participantes: ["ADMIN", "OPERATOR"],
  kits: ["ADMIN", "OPERATOR"],
  asistencia: ["ADMIN", "OPERATOR"],
  cierre: ["ADMIN"],
  comunidad: ["ADMIN", "MODERATOR"],
  usuarios: ["ADMIN"],
  comunicaciones: ["ADMIN", "OPERATOR"],
  auditoria: ["ADMIN"],
  ajustes: ["ADMIN"],
};

/** Distinct roles held, in canonical order (any scope). */
export function rolesOf(assignments: readonly StaffAssignment[]): StaffRole[] {
  const held = new Set(assignments.map((assignment) => assignment.role));
  return STAFF_ROLE_ORDER.filter((role) => held.has(role));
}

/** Section visibility for the nav: any assignment (GLOBAL or EDITION) of an allowed role. */
export function canAccessSection(assignments: readonly StaffAssignment[], key: AdminNavKey): boolean {
  const allowed = NAV_ACCESS[key];
  return assignments.some((assignment) => allowed.includes(assignment.role));
}

/** Nav keys a staff member should see, in the shell's own order. */
export function visibleNavKeysFor(assignments: readonly StaffAssignment[], allKeys: readonly AdminNavKey[]): AdminNavKey[] {
  return allKeys.filter((key) => canAccessSection(assignments, key));
}

/**
 * Edition-scoped check, same rule as lib/server/auth/guards.ts hasStaffRole: a GLOBAL assignment of an
 * allowed role, or an EDITION assignment for exactly this Edition.
 */
export function hasRoleForEdition(
  assignments: readonly StaffAssignment[],
  allowed: readonly StaffRole[],
  editionId: string,
): boolean {
  return assignments.some(
    (assignment) =>
      allowed.includes(assignment.role) &&
      (assignment.scope_type === "GLOBAL" ||
        (assignment.scope_type === "EDITION" && assignment.edition_id?.toLowerCase() === editionId.toLowerCase())),
  );
}

/** Human summary of one assignment, e.g. "Operador · Global" / "Operador · Edición". */
export function describeAssignment(assignment: StaffAssignment): string {
  return `${STAFF_ROLE_LABEL[assignment.role]} · ${assignment.scope_type === "GLOBAL" ? "Global" : "Una edición"}`;
}
