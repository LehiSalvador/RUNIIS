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
import { KitCenter } from "@/components/admin/raceday/kit-center";
import { KitParticipants, type KitParticipant } from "@/components/admin/raceday/kit-participants";
import { KIT_STATUS_LABEL, type KitRow } from "@/components/admin/raceday/kit-logic";
import { PanelsSkeleton, TableSkeleton } from "@/components/admin/skeletons";
import { BackToEdition, EditionSectionBody, type EditorData } from "@/app/admin/eventos/_lib/section-body";
import { requireStaff, settle } from "@/app/admin/_lib/session";
import { kitCenterInventory } from "@/lib/server/domain/raceday/service";
import { adminListParticipants } from "@/lib/server/domain/registration/service";

export const metadata: Metadata = { title: "Kits" };

const TITLE = "Kits";
const KIT_FILTER = ["ASSIGNED", "READY", "DELIVERED", "EXCEPTION", "NONE"] as const;
const PAGE_SIZES = ["10", "25", "50"] as const;

const FILTERS: readonly FilterField[] = [
  { type: "search", name: "search", label: "Buscar", placeholder: "Nombre o número de inscripción" },
  { type: "select", name: "kit", label: "Kit", options: KIT_FILTER.map((value) => ({ value, label: KIT_STATUS_LABEL[value] })) },
];

export default async function EditionKitsPage({
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
  const path = withQuery(`/admin/eventos/${editionId}/kits`, current.toString());

  const gate = await requireStaff(path, "kits", { editionId });
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
          <PanelsSkeleton count={2} label="Cargando kits" />
        </AdminPage>
      }
    >
      <EditionSectionBody
        supabase={supabase}
        assignments={assignments}
        editionId={editionId}
        section="kits"
        title={TITLE}
        region="kits.edition"
        render={({ editor }) => {
          const locked = editor.edition.execution_state === "FINISHED" || editor.edition.execution_state === "CANCELED";
          return (
            <div className="flex flex-col gap-6">
              <Suspense fallback={<PanelsSkeleton count={2} label="Cargando inventario" />}>
                <InventoryRegion supabase={supabase} editionId={editionId} editor={editor} locked={locked} />
              </Suspense>
              <FilterBar fields={FILTERS} />
              <Suspense key={current.toString()} fallback={<TableSkeleton rows={6} columns={4} label="Cargando participantes" />}>
                <ParticipantsRegion supabase={supabase} editionId={editionId} params={raw} editor={editor} locked={locked} />
              </Suspense>
            </div>
          );
        }}
      />
    </Suspense>
  );
}

async function loadKits(supabase: SupabaseClient, editionId: string, editor: EditorData) {
  const result = await settle(kitCenterInventory(supabase, editionId), "kits.inventory");
  if (!result.ok) return result;
  const instructions = new Map(editor.kits.map((kit) => [kit.kit_definition_id, kit.instructions] as const));
  const kits: KitRow[] = result.data.map((kit) => ({ ...kit, instructions: instructions.get(kit.kit_definition_id) ?? null }));
  return { ok: true as const, data: kits };
}

async function InventoryRegion({ supabase, editionId, editor, locked }: { supabase: SupabaseClient; editionId: string; editor: EditorData; locked: boolean }) {
  const result = await loadKits(supabase, editionId, editor);
  if (!result.ok) return <ErrorNotice code={result.code} requestId={result.requestId} title="No pudimos cargar el inventario de kits." />;
  return <KitCenter editionId={editionId} timezone={editor.edition.timezone} kits={result.data} locked={locked} />;
}

async function ParticipantsRegion({
  supabase,
  editionId,
  params,
  editor,
  locked,
}: {
  supabase: SupabaseClient;
  editionId: string;
  params: RawSearchParams;
  editor: EditorData;
  locked: boolean;
}) {
  const filters = {
    search: firstParam(params, "search")?.slice(0, 100),
    kit: enumParam(params, "kit", KIT_FILTER),
  };
  const cursor = firstParam(params, "cursor");
  const limit = enumParam(params, "limit", PAGE_SIZES) ?? "25";
  const result = await settle(adminListParticipants(supabase, editionId, { status: "CONFIRMED", ...filters, cursor, limit: Number(limit) }), "kits.participants");
  if (!result.ok) return <ErrorNotice code={result.code} requestId={result.requestId} title="No pudimos cargar a los participantes." />;

  const rows: KitParticipant[] = result.data.items.map((row) => ({
    registration_id: row.registration_id,
    registration_number: row.registration_number,
    full_name: row.full_name,
    modality: { name: row.modality?.name ?? "" },
    is_minor: row.is_minor,
    pass: row.pass,
    kit: row.kit,
  }));
  const activeKits = editor.kits.filter((kit) => kit.status === "ACTIVE").map((kit) => ({ kit_definition_id: kit.kit_definition_id, name: kit.name }));

  const query = new URLSearchParams();
  for (const [name, value] of Object.entries({ ...filters, cursor, limit: limit === "25" ? undefined : limit })) if (value) query.set(name, value);
  const nextParams = new URLSearchParams(nextQuery(query, {}));
  if (result.data.nextCursor) nextParams.set("cursor", result.data.nextCursor);
  const base = `/admin/eventos/${editionId}/kits`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-caption text-ink-60" role="status" aria-live="polite">
          {rows.length === 0 ? "Sin resultados" : `${rows.length} ${rows.length === 1 ? "participante" : "participantes"} en esta página${result.data.nextCursor ? " (hay más)" : ""}`}
        </p>
        <DataFreshness loadedAt={new Date().toISOString()} />
      </div>
      <KitParticipants rows={rows} editionId={editionId} activeKits={activeKits} locked={locked} />
      <CursorPager
        shown={rows.length}
        noun={rows.length === 1 ? "participante" : "participantes"}
        nextHref={result.data.nextCursor ? withQuery(base, nextParams.toString()) : null}
        firstHref={cursor ? withQuery(base, nextQuery(query, {})) : null}
      />
    </div>
  );
}
