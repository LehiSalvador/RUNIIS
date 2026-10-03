import React from "react";
import { AdminShell } from "@/components/shell/admin-shell";
import { ADMIN_NAV_KEYS } from "@/components/shell/admin-nav-items";
import { visibleNavKeysFor, type StaffAssignment } from "@/components/admin/access";
import { StaffIdentity } from "@/components/admin/staff-identity";

/**
 * Standard frame of every admin page: the live AdminShell with the nav filtered by the viewer's roles
 * (hiding only; the server guard already decided access) and the staff identity footer. Later units
 * compose their screens inside this and never import AdminShell directly, so the frame stays uniform.
 *
 *   <AdminPage assignments={staff.assignments} title="Eventos" actions={<...>}>...</AdminPage>
 */
export function AdminPage({
  assignments,
  title,
  actions,
  children,
}: {
  assignments: readonly StaffAssignment[];
  title: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <AdminShell
      pageTitle={title}
      navMode="live"
      visibleNavKeys={visibleNavKeysFor(assignments, ADMIN_NAV_KEYS)}
      actions={actions}
      sidebarFooter={<StaffIdentity name={null} assignments={assignments} />}
    >
      {children}
    </AdminShell>
  );
}
