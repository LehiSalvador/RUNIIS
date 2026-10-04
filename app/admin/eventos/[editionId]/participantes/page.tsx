import type { Metadata } from "next";
import React, { Suspense } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { AdminNotFound } from "@/components/admin/access-states";
import { AdminPage } from "@/components/admin/admin-page";
import { CursorPager } from "@/components/admin/cursor-pager";
import { DataFreshness } from "@/components/admin/data-freshness";
import { ErrorNotice } from "@/components/admin/error-notice";
import { FilterBar, type FilterField } from "@/components/admin/filter-bar";
import { enumParam, firstParam, nextQuery, withQuery, type RawSearchParams } from "@/components/admin/filters";
import { ExportCsvDialog } from "@/components/admin/participants/export-csv-dialog";
import { ATTENDANCE_LABEL, KIND_LABEL, REGISTRATION_STATUS_LABEL, type ParticipantRowView } from "@/components/admin/participants/participant-logic";
import { ParticipantsTable } from "@/components/admin/participants/participants-table";
import { KIT_STATUS_LABEL } from "@/components/admin/raceday/kit-logic";
import { PanelsSkeleton, TableSkeleton } from "@/components/admin/skeletons";
import { BackToEdition, EditionSectionBody, type EditorData } from "@/app/admin/eventos/_lib/section-body";
import { requireStaff, settle } from "@/app/admin/_lib/session";
import { adminListParticipants } from "@/lib/server/domain/registration/service";

export const metadata: Metadata = { title: "Participantes" };

const TITLE = "Participantes";
const PAGE_SIZES = ["10", "25", "50"] as const;
const STATUS = ["CONFIRMED", "CANCELED"] as const;
const TYPE = ["PROFILE", "GUEST"] as const;
const KIT = ["ASSIGNED", "READY", "DELIVERED", "CANCELED", "EXCEPTION", "NONE"] as const;
const ATTENDANCE = ["PENDING", "PRESENT", "NO_SHOW", "EXCLUDED", "NONE"] as const;

export default async function EditionParticipantsPage({
  params,
  searchParams,
}: {
  params: Promise<{ editionId: string }>;
  searchParams: Promise<RawSearchParams>;
}) {
  const { editionId } = await params;
  const raw = await searchParams;
  const current = new URLSearchParams();
  for (const [name, value] of Object.entries(raw)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (first) current.set(name, first);
  }
  const path = withQuery(`/admin/eventos/${editionId}/participantes`, current.toString());

  const gate = await requireStaff(path, "participantes", { editionId });
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
          <PanelsSkeleton count={2} label="Cargando participantes" />
        </AdminPage>
      }
    >
      <EditionSectionBody
        supabase={supabase}
        assignments={assignments}
        editionId={editionId}
        section="participantes"
        title={TITLE}
        region="participants.edition"
        render={({ editor }) => (
          <div className="flex flex-col gap-4">
            <FilterBar fields={filterFields(editor)} />
            <Suspense key={current.toString()} fallback={<TableSkeleton rows={6} columns={4} label="Cargando participantes" />}>
              <ParticipantsRegion supabase={supabase} editionId={editionId} params={raw} editor={editor} />
            </Suspense>
          </div>
        )}
      />
    </Suspense>
  );
}

function filterFields(editor: EditorData): FilterField[] {
  return [
    { type: "search", name: "search", label: "Buscar", placeholder: "Nombre, número de inscripción o código del pase" },
    { type: "select", name: "status", label: "Estado", options: STATUS.map((value) => ({ value, label: REGISTRATION_STATUS_LABEL[value] })) },
    { type: "select", name: "modality_id", label: "Modalidad", options: editor.modalities.map((modality) => ({ value: modality.modality_id, label: modality.name })) },
    { type: "select", name: "type", label: "Tipo", options: TYPE.map((value) => ({ value, label: KIND_LABEL[value] })) },
    { type: "select", name: "kit", label: "Kit", options: KIT.map((value) => ({ value, label: value === "NONE" ? "Sin kit" : (KIT_STATUS_LABEL[value] ?? value) })) },
    { type: "select", name: "attendance", label: "Asistencia", options: ATTENDANCE.map((value) => ({ value, label: value === "NONE" ? "Sin resolver" : ATTENDANCE_LABEL[value] })) },
  ];
}

async function ParticipantsRegion({ supabase, editionId, params, editor }: { supabase: SupabaseClient; editionId: string; params: RawSearchParams; editor: EditorData }) {
  const modalityIds = new Set(editor.modalities.map((modality) => modality.modality_id));
  const modalityParam = firstParam(params, "modality_id");
  const filters = {
    status: enumParam(params, "status", STATUS),
    modality_id: modalityParam && modalityIds.has(modalityParam) ? modalityParam : undefined,
    type: enumParam(params, "type", TYPE),
    kit: enumParam(params, "kit", KIT),
    attendance: enumParam(params, "attendance", ATTENDANCE),
    search: firstParam(params, "search")?.slice(0, 100),
  };
  const cursor = firstParam(params, "cursor");
  const limit = enumParam(params, "limit", PAGE_SIZES) ?? "25";
  const result = await settle(adminListParticipants(supabase, editionId, { ...filters, cursor, limit: Number(limit) }), "participants.list");
  if (!result.ok) return <ErrorNotice code={result.code} requestId={result.requestId} title="No pudimos cargar a los participantes." />;

  const rows = result.data.items as ParticipantRowView[];
  // Contact data and the export exist only for a viewer the API allowed (PII permission): the server's own flag, never a guess.
  const contactVisible = result.data.contactVisible;
  const zone = editor.edition.timezone;

  const query = new URLSearchParams();
  for (const [name, value] of Object.entries({ ...filters, cursor, limit: limit === "25" ? undefined : limit })) if (value) query.set(name, value);
  const nextParams = new URLSearchParams(nextQuery(query, {}));
  if (result.data.nextCursor) nextParams.set("cursor", result.data.nextCursor);
  const base = `/admin/eventos/${editionId}/participantes`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-caption text-ink-60" role="status" aria-live="polite">
          {rows.length === 0 ? "Sin resultados" : `${rows.length} ${rows.length === 1 ? "participante" : "participantes"} en esta página${result.data.nextCursor ? " (hay más)" : ""}`}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          {contactVisible ? <ExportCsvDialog editionId={editionId} filters={{ ...filters }} /> : null}
          <DataFreshness loadedAt={new Date().toISOString()} timeZone={zone} />
        </div>
      </div>
      <ParticipantsTable
        rows={rows}
        editionId={editionId}
        timeZone={zone}
        modalities={editor.modalities.map((modality) => ({ modality_id: modality.modality_id, name: modality.name, status: modality.status }))}
        categories={editor.categories.map((category) => ({
          category_id: category.category_id,
          name: category.name,
          assignment_mode: category.assignment_mode,
          active: category.active,
          modality_ids: category.modality_ids,
        }))}
        showContact={contactVisible}
        editionClosed={editor.edition.closure_state === "CLOSED"}
      />
      <CursorPager
        shown={rows.length}
        noun={rows.length === 1 ? "participante" : "participantes"}
        nextHref={result.data.nextCursor ? withQuery(base, nextParams.toString()) : null}
        firstHref={cursor ? withQuery(base, nextQuery(query, {})) : null}
      />
    </div>
  );
}
