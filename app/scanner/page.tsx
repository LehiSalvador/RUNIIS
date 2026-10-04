import type { Metadata } from "next";
import React from "react";
import { AdminForbidden } from "@/components/admin/access-states";
import { AdminPage } from "@/components/admin/admin-page";
import { ErrorNotice } from "@/components/admin/error-notice";
import { ScannerApp } from "@/components/scanner/scanner-app";
import { requireStaff } from "@/app/admin/_lib/session";
import { SCANNER_ROLES, loadScannerEditions } from "@/app/scanner/_lib/editions";

export const metadata: Metadata = { title: "Escáner de acceso" };

// Per request and per person: the Editions offered depend on the staff assignments.
export const dynamic = "force-dynamic";

export default async function ScannerPage() {
  // The guard answers an anonymous visitor with a real redirect to sign-in (back to /scanner afterwards). The section key only picks the
  // base role check ("any staff role"); the scanner's own role list (ADMIN, OPERATOR, CHECKIN, the roles the scan API authorises) is
  // enforced right below, so a MODERATOR never reaches the camera. The API re-authorises every scan regardless.
  const gate = await requireStaff("/scanner", "dashboard");
  if (!gate.allowed) return gate.forbidden;
  const { supabase, assignments } = gate.staff;

  if (!assignments.some((assignment) => SCANNER_ROLES.includes(assignment.role))) {
    return (
      <AdminPage assignments={assignments} title="Acceso restringido">
        <AdminForbidden staff />
      </AdminPage>
    );
  }

  const editions = await loadScannerEditions(supabase);
  if (!editions.ok) {
    // A failed read is not "you have no editions": say what happened and keep the support reference.
    return (
      <AdminPage assignments={assignments} title="Escáner de acceso">
        <ErrorNotice code={editions.code} requestId={editions.requestId} title="No pudimos cargar las ediciones del escáner." />
      </AdminPage>
    );
  }
  return <ScannerApp editions={editions.data} />;
}
