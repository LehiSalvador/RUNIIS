import "server-only";
import React from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { AdminForbidden } from "@/components/admin/access-states";
import { AdminPage } from "@/components/admin/admin-page";
import { NAV_ACCESS, type StaffAssignment } from "@/components/admin/access";
import type { AdminNavKey } from "@/components/shell/admin-nav-items";
import { resolveActor, type Actor } from "@/lib/server/auth/actor";
import { assertAuthLevel } from "@/lib/server/auth/guards";
import { AppError, toAppError } from "@/lib/server/http/errors";
import { logEvent } from "@/lib/server/log";
import { newRequestId } from "@/lib/server/http/request-id";
import type { ErrorCode } from "@/lib/shared/api-contract";
import { createSessionClient } from "@/lib/server/supabase/clients";

/**
 * Server-side guard for every admin page. The server is the authority: each page resolves the session and
 * the staff roles itself, BEFORE rendering anything (so an anonymous visitor gets a real redirect, not a
 * streamed one), and renders the forbidden state for a signed-in visitor whose role cannot open the section.
 * The nav hides what the role cannot use, but that is cosmetics: this guard, the API route guards and the DB
 * commands each re-authorise independently.
 *
 *   const gate = await requireStaff("/admin/eventos", "eventos");
 *   if (!gate.allowed) return gate.forbidden;
 *   const { supabase, assignments } = gate.staff;
 *
 * The roles come from `public.current_actor()`; the rule is the same function the API uses
 * (assertAuthLevel with the section's role list), so a page and its API cannot disagree.
 */
export type StaffContext = {
  supabase: SupabaseClient;
  actor: Actor;
  assignments: StaffAssignment[];
};

export type StaffGate =
  | { allowed: true; staff: StaffContext }
  | { allowed: false; forbidden: React.ReactNode };

export async function requireStaff(
  currentPath: string,
  section: AdminNavKey,
  options: { editionId?: string } = {},
): Promise<StaffGate> {
  const supabase = await createSessionClient();
  const actor = await resolveActor(supabase);
  if (!actor.auth_user_id) redirect(`/entrar?next=${encodeURIComponent(currentPath)}`);

  const assignments: StaffAssignment[] = actor.staff_member_id ? actor.staff_roles : [];
  try {
    assertAuthLevel(
      actor,
      { staff: NAV_ACCESS[section], editionParam: options.editionId ? "editionId" : undefined },
      { editionId: options.editionId },
    );
  } catch (error) {
    if (!(error instanceof AppError) || error.code !== "FORBIDDEN") throw error;
    // The line is for support/audit: who was refused where. No role names or ids of other records.
    logEvent("warn", "admin_page_forbidden", { section, staff: assignments.length > 0, scoped: Boolean(options.editionId) });
    return {
      allowed: false,
      forbidden: (
        <AdminPage assignments={assignments} title="Acceso restringido">
          <AdminForbidden staff={assignments.length > 0} />
        </AdminPage>
      ),
    };
  }
  return { allowed: true, staff: { supabase, actor, assignments } };
}

export type Loaded<T> = { ok: true; data: T } | { ok: false; code: ErrorCode; requestId: string };

/**
 * Per-region read: one failing read renders that region's error state (ErrorNotice) and never the whole page.
 * A server-side render has no HTTP request id, so a support reference is minted and logged with the error code:
 * the operator reads it off the screen and support finds the line. Raw error text is never kept or shown.
 */
export async function settle<T>(promise: Promise<T>, region: string): Promise<Loaded<T>> {
  try {
    return { ok: true, data: await promise };
  } catch (error) {
    const code = toAppError(error, { surface: "admin_page" }).code;
    const requestId = newRequestId();
    logEvent("warn", "admin_read_failed", { region, code, support_ref: requestId });
    return { ok: false, code, requestId };
  }
}
