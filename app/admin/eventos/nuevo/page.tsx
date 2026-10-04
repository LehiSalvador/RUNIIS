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
import { adminListEditions } from "@/lib/server/domain/events/service";
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

async function NewEditionForm({ supabase }: { supabase: SupabaseClient }) {
  const [types, editions] = await Promise.all([
    settle(getActiveEventTypes(), "events.new.types"),
    // There is no "list events" API yet: the events that already have an Edition are read from the Editions list.
    settle(adminListEditions(supabase, { limit: 100 }), "events.new.events"),
  ]);
  if (!types.ok) return <ErrorNotice code={types.code} requestId={types.requestId} title="No pudimos cargar los tipos de evento." />;
  if (!editions.ok) return <ErrorNotice code={editions.code} requestId={editions.requestId} title="No pudimos cargar los eventos." />;

  const seen = new Map<string, EventChoice>();
  for (const item of editions.data.items) if (!seen.has(item.event_id)) seen.set(item.event_id, { event_id: item.event_id, name: item.event_name });
  const events = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name, "es"));
  const eventTypes: EventTypeChoice[] = types.data.map((type) => ({ key: type.key, name: type.name }));

  return <EditionForm mode="create" events={events} eventTypes={eventTypes} />;
}
