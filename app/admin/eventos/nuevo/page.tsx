import type { Metadata } from "next";
import Link from "next/link";
import React, { Suspense } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ArrowLeft } from "lucide-react";
import { AdminForbidden } from "@/components/admin/access-states";
import { AdminPage } from "@/components/admin/admin-page";
import { ErrorNotice } from "@/components/admin/error-notice";
import { EditionForm, type EventChoice, type EventTypeChoice } from "@/components/admin/events/edition-form";
import { isGlobalAdmin } from "@/components/admin/events/permissions";
import { PanelsSkeleton } from "@/components/admin/skeletons";
import { buttonVariants } from "@/components/ui/button";
import { getActiveEventTypes } from "@/lib/server/domain/discovery/service";
import { adminListEvents } from "@/lib/server/domain/events/service";
import { requireStaff, settle } from "@/app/admin/_lib/session";

export const metadata: Metadata = { title: "Nueva edición" };

function BackToList() {
  return (
    <Link href="/admin/eventos" prefetch={false} className={buttonVariants({ variant: "secondary", size: "sm" })}>
      <ArrowLeft className="size-4" aria-hidden="true" />
      Todas las ediciones
    </Link>
  );
}

export default async function NewEditionPage() {
  const gate = await requireStaff("/admin/eventos/nuevo", "eventos");
  if (!gate.allowed) return gate.forbidden;
  const { supabase, assignments } = gate.staff;

  // EVENT_CREATE / EDITION_CREATE are GLOBAL ADMIN only (the commands refuse anything else; this is the page-level refusal).
  if (!isGlobalAdmin(assignments)) {
    return (
      <AdminPage assignments={assignments} title="Nueva edición" actions={<BackToList />}>
        <AdminForbidden />
      </AdminPage>
    );
  }

  return (
    <AdminPage assignments={assignments} title="Nueva edición" actions={<BackToList />}>
      <Suspense fallback={<PanelsSkeleton count={3} label="Cargando el formulario" />}>
        <NewEditionForm supabase={supabase} />
      </Suspense>
    </AdminPage>
  );
}

const CATALOGUE_PAGE = 100;
const CATALOGUE_PAGES = 3;

async function NewEditionForm({ supabase }: { supabase: SupabaseClient }) {
  const [types, catalogue] = await Promise.all([
    settle(getActiveEventTypes(), "events.new.types"),
    // The Events catalogue (P3-L): every ACTIVE Event, including those that still have no Edition. Up to three pages of 100.
    settle(loadEventCatalogue(supabase), "events.new.events"),
  ]);
  if (!types.ok) return <ErrorNotice code={types.code} requestId={types.requestId} title="No pudimos cargar los tipos de evento." />;
  if (!catalogue.ok) return <ErrorNotice code={catalogue.code} requestId={catalogue.requestId} title="No pudimos cargar los eventos." />;

  const events: EventChoice[] = catalogue.data.items
    .map((item) => ({
      event_id: item.event_id,
      name: item.name,
      canonical_key: item.canonical_key,
      status: item.status,
      event_type_key: item.event_type_key,
      event_type_name: item.event_type_name,
      edition_count: item.edition_count,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
  const eventTypes: EventTypeChoice[] = types.data.map((type) => ({ key: type.key, name: type.name }));

  return <EditionForm mode="create" events={events} eventTypes={eventTypes} eventsTruncated={catalogue.data.truncated} />;
}

async function loadEventCatalogue(supabase: SupabaseClient) {
  type Item = Awaited<ReturnType<typeof adminListEvents>>["items"][number];
  const items: Item[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < CATALOGUE_PAGES; page++) {
    const result = await adminListEvents(supabase, { status: "ACTIVE", cursor, limit: CATALOGUE_PAGE });
    items.push(...result.items);
    if (!result.nextCursor) return { items, truncated: false };
    cursor = result.nextCursor;
  }
  return { items, truncated: true };
}
