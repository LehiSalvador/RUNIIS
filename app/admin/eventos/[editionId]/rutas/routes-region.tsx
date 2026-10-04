import React from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ErrorNotice } from "@/components/admin/error-notice";
import { RouteWorkspace } from "@/components/admin/routes/route-workspace";
import { defaultRevisionId, type ModalityOption, type RevisionFull, type RouteDetail, type RouteRow } from "@/components/admin/routes/route-geometry";
import { adminGetRoute, adminGetRouteRevision, adminListRoutes } from "@/lib/server/domain/routes/service";
import { settle, type Loaded } from "@/app/admin/_lib/session";
import type { EditorData } from "@/app/admin/eventos/_lib/section-body";

const id = z.guid();

/**
 * Data region of the route screen (streams inside the page's Suspense). Reads go through the same service layer the admin API uses, so the
 * Edition scope and the role are enforced by the database for this read as well. A selection in the URL that does not belong to this
 * Edition is ignored (the Routes of THIS Edition are the only candidates), and every read failure renders its own error state.
 */
export async function RoutesRegion({
  supabase,
  editionId,
  editor,
  routeParam,
  revisionParam,
}: {
  supabase: SupabaseClient;
  editionId: string;
  editor: EditorData;
  routeParam: string | undefined;
  revisionParam: string | undefined;
}) {
  const list = await settle(adminListRoutes(supabase, editionId), "events.routes.list");
  if (!list.ok) return <ErrorNotice code={list.code} requestId={list.requestId} title="No pudimos cargar las rutas." />;
  const routes = list.data as RouteRow[];

  const requested = routeParam && id.safeParse(routeParam).success ? routes.find((route) => route.route_id === routeParam) : undefined;
  const chosen = requested ?? routes[0];

  let detail: Loaded<RouteDetail> | null = null;
  let revision: Loaded<RevisionFull> | null = null;
  if (chosen) {
    detail = (await settle(adminGetRoute(supabase, chosen.route_id), "events.routes.detail")) as Loaded<RouteDetail>;
    if (!detail.ok) return <ErrorNotice code={detail.code} requestId={detail.requestId} title="No pudimos cargar la ruta." />;
    const known = new Set(detail.data.revisions.map((entry) => entry.route_revision_id));
    const revisionId = revisionParam && id.safeParse(revisionParam).success && known.has(revisionParam) ? revisionParam : defaultRevisionId(detail.data);
    if (revisionId) revision = (await settle(adminGetRouteRevision(supabase, revisionId), "events.routes.revision")) as Loaded<RevisionFull>;
  }

  const modalities: ModalityOption[] = editor.modalities.map((modality) => ({
    modality_id: modality.modality_id,
    name: modality.name,
    official_distance_m: modality.official_distance_m,
    status: modality.status,
  }));

  return (
    <RouteWorkspace
      editionId={editionId}
      routes={routes}
      selected={detail?.ok ? detail.data : null}
      revision={revision?.ok ? revision.data : null}
      revisionError={revision && !revision.ok ? { code: revision.code, requestId: revision.requestId } : null}
      modalities={modalities}
      timeZone={editor.edition.timezone}
    />
  );
}
