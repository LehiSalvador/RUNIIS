import React from "react";
import { SignOutButton } from "@/components/account/sign-out-button";
import { describeAssignment, type StaffAssignment } from "@/components/admin/access";

/**
 * Sidebar footer: who is operating and with which role/scope (so an operator always knows what they are
 * allowed to do, and support can read it off a screenshot), plus sign-out. Display only: authorization is
 * decided on the server on every request.
 */
export function StaffIdentity({ name, assignments }: { name: string | null; assignments: readonly StaffAssignment[] }) {
  return (
    <div className="flex flex-col gap-2 border-t border-divider pt-4">
      <div className="px-3">
        <p className="truncate text-body-sm font-semibold text-ink">{name ?? "Staff"}</p>
        <ul className="mt-0.5 text-caption text-ink-60">
          {assignments.map((assignment, index) => (
            <li key={`${assignment.role}-${assignment.scope_type}-${assignment.edition_id ?? index}`}>{describeAssignment(assignment)}</li>
          ))}
        </ul>
      </div>
      <SignOutButton variant="ghost" size="sm" className="justify-start" />
    </div>
  );
}
