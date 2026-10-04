import type { Metadata } from "next";
import type { SupabaseClient } from "@supabase/supabase-js";
import React, { Suspense } from "react";
import { z } from "zod";
import { AdminNotFound } from "@/components/admin/access-states";
import { AdminPage } from "@/components/admin/admin-page";
import { FormsManager } from "@/components/admin/edition-config/forms-manager";
import { LegalStatus } from "@/components/admin/edition-config/legal-status";
import { buildFormScopes, type FormVersion } from "@/components/admin/edition-config/config-model";
import { ErrorNotice } from "@/components/admin/error-notice";
import { isGlobalAdmin } from "@/components/admin/events/permissions";
import { PanelsSkeleton } from "@/components/admin/skeletons";
import { adminListLegalDocuments } from "@/lib/server/domain/events/service";
import { BackToEdition, EditionSectionBody } from "@/app/admin/eventos/_lib/section-body";
import { requireStaff, settle } from "@/app/admin/_lib/session";

export const metadata: Metadata = { title: "Formularios de inscripción" };

const TITLE = "Formularios de inscripción";

export default async function EditionFormsPage({ params }: { params: Promise<{ editionId: string }> }) {
  const { editionId } = await params;
  const gate = await requireStaff(`/admin/eventos/${editionId}/formularios`, "eventos", { editionId });
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
          <PanelsSkeleton count={3} label="Cargando formularios" />
        </AdminPage>
      }
    >
      <EditionSectionBody
        supabase={supabase}
        assignments={assignments}
        editionId={editionId}
        section="formularios"
        title={TITLE}
        region="events.forms"
        render={({ editor, assignments: staff }) => {
          const { edition, modalities, registration_forms: forms, readiness } = editor;
          const frozen = edition.execution_state === "FINISHED" || edition.execution_state === "CANCELED";
          const formCheck = readiness.registration.checks.find((check) => check.code === "FORM_PUBLISHED");
          return (
            <>
              <p
                className={`rounded-control border px-3 py-2 text-body-sm text-ink ${formCheck?.ok ? "border-success-border bg-success-tint" : "border-warning-border bg-warning-tint"}`}
                role="note"
                data-testid="form-readiness-note"
              >
                {formCheck?.ok
                  ? "Cada modalidad activa tiene un formulario publicado (el servidor lo confirma)."
                  : "Falta un formulario publicado para al menos una modalidad activa. Publica el formulario de «Todas las modalidades» o uno por modalidad para abrir inscripciones."}
              </p>
              <FormsManager
                editionId={editionId}
                timezone={edition.timezone}
                frozen={frozen}
                scopes={buildFormScopes(forms as FormVersion[], modalities)}
              />
              {isGlobalAdmin(staff) ? (
                <Suspense fallback={<PanelsSkeleton count={1} label="Cargando documentos legales" />}>
                  <LegalRegion supabase={supabase} editionId={editionId} timezone={edition.timezone} />
                </Suspense>
              ) : null}
            </>
          );
        }}
      />
    </Suspense>
  );
}

async function LegalRegion({ supabase, editionId, timezone }: { supabase: SupabaseClient; editionId: string; timezone: string }) {
  const result = await settle(adminListLegalDocuments(supabase), "events.forms.legal");
  if (!result.ok) return <ErrorNotice code={result.code} requestId={result.requestId} title="No pudimos cargar el estado de los documentos legales." />;
  return <LegalStatus editionId={editionId} timezone={timezone} documents={result.data} />;
}
