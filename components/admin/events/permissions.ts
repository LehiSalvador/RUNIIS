import { hasRoleForEdition, type StaffAssignment } from "@/components/admin/access";

/**
 * Display-side permission hints for the event screens. They only decide what to show or disable; every API
 * command re-authorises (EDITION_CREATE is GLOBAL ADMIN only; the lifecycle commands need ADMIN on the Edition).
 */
export function isGlobalAdmin(assignments: readonly StaffAssignment[]): boolean {
  return assignments.some((assignment) => assignment.role === "ADMIN" && assignment.scope_type === "GLOBAL");
}

export function canManageLifecycle(assignments: readonly StaffAssignment[], editionId: string): boolean {
  return hasRoleForEdition(assignments, ["ADMIN"], editionId);
}
