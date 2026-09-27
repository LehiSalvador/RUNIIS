import "server-only";
import { AppError } from "../http/errors";
import type { Actor, StaffRole } from "./actor";

export type AuthLevel =
  | "public"
  | "authenticated"
  | "ready"
  | { staff: readonly StaffRole[]; /** Route param holding the Edition id for EDITION-scoped roles. */ editionParam?: string };

type RouteParams = Record<string, string | string[] | undefined>;

/** Early reject only: passing a guard never authorises a mutation, the DB command does. */
export function assertAuthLevel(actor: Actor, level: AuthLevel, params: RouteParams = {}): void {
  if (level === "public") return;
  if (!actor.auth_user_id) throw new AppError("AUTH_REQUIRED");
  if (level === "authenticated") return;

  if (level === "ready") {
    if (actor.account_state === "BANNED") throw new AppError("ACCOUNT_BANNED");
    if (actor.account_state === "IDENTITY_LOCKED") throw new AppError("IDENTITY_LOCKED");
    if (actor.account_state !== "ACTIVE") throw new AppError("FORBIDDEN");
    if (!actor.runner_profile_id || actor.profile_readiness !== "READY") throw new AppError("PROFILE_INCOMPLETE");
    return;
  }

  if (!actor.staff_member_id || !hasStaffRole(actor, level.staff, level.editionParam, params)) {
    throw new AppError("FORBIDDEN");
  }
}

function hasStaffRole(actor: Actor, roles: readonly StaffRole[], editionParam: string | undefined, params: RouteParams): boolean {
  const candidates = actor.staff_roles.filter((assignment) => roles.includes(assignment.role));
  if (editionParam === undefined) return candidates.length > 0;
  const editionId = params[editionParam];
  if (typeof editionId !== "string") return false;
  return candidates.some(
    (assignment) =>
      assignment.scope_type === "GLOBAL" ||
      (assignment.scope_type === "EDITION" && assignment.edition_id?.toLowerCase() === editionId.toLowerCase()),
  );
}
