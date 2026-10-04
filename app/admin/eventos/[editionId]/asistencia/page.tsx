import type { Metadata } from "next";
import React, { Suspense } from "react";
import { z } from "zod";
import { AdminNotFound } from "@/components/admin/access-states";
import { AdminPage } from "@/components/admin/admin-page";
import { hasRoleForEdition } from "@/components/admin/access";
import { AttendanceDesk } from "@/components/admin/closure/attendance-desk";
import { ClosureFrame } from "@/components/admin/closure/edition-frame";
import { PanelsSkeleton } from "@/components/admin/skeletons";
import { BackToEdition } from "@/app/admin/eventos/_lib/section-body";
import { requireStaff } from "@/app/admin/_lib/session";

export const metadata: Metadata = { title: "Asistencia" };

const TITLE = "Asistencia";

/**
 * Attendance desk of one Edition (P3-I, Master sections 90-95). ADMIN and OPERATOR, for this Edition. The page awaits the staff guard first and
 * streams the Edition header; the workspace itself is read by the desk in the browser because the API reconciles the universe (it writes), so it
 * is called explicitly and never prefetched.
 */
export default async function EditionAttendancePage({ params }: { params: Promise<{ editionId: string }> }) {
  const { editionId } = await params;
  const gate = await requireStaff(`/admin/eventos/${editionId}/asistencia`, "asistencia", { editionId });
  if (!gate.allowed) return gate.forbidden;
  const { supabase, assignments } = gate.staff;

  // A malformed id can never name an Edition; answer "not found" without a database round trip.
  if (!z.guid().safeParse(editionId).success) {
    return (
      <AdminPage assignments={assignments} title={TITLE}>
        <AdminNotFound backHref="/admin/eventos" backLabel="Volver a eventos" />
      </AdminPage>
    );
  }

  return (
    <Suspense
      fallback={
        <AdminPage assignments={assignments} title={TITLE} actions={<BackToEdition editionId={editionId} />}>
          <PanelsSkeleton count={2} label="Cargando la asistencia" />
        </AdminPage>
      }
    >
      <ClosureFrame
        supabase={supabase}
        assignments={assignments}
        editionId={editionId}
        title={TITLE}
        section="asistencia"
        region="attendance.edition"
        render={(edition) => <AttendanceDesk editionId={editionId} timeZone={edition.timezone} canOpenClosure={hasRoleForEdition(assignments, ["ADMIN"], editionId)} />}
      />
    </Suspense>
  );
}
