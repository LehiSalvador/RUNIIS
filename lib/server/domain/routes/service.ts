import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import type { JsonObject } from "@/lib/shared/api-contract";
import { logEvent } from "../../log";
import { callRpc } from "../../rpc";
import {
  importGpxBodySchema,
  publicRouteListSchema,
  routeListSchema,
  routeRevisionSchema,
  routeSchema,
  routeWithRevisionsSchema,
  validationResultSchema,
} from "./contracts";
import { parseGpxSafely } from "./gpx-parser";

// Thin RPC layer over supabase/migrations/20260928120000_320_routes_commands.sql and
// 20260928120100_321_routes_queries.sql. Rate-limiting (admin.mutation:cmd) and permission
// enforcement (EVENT_CONTENT_MANAGE, scoped from the target row) happen inside private.cfg_authorize
// in the database; this layer only validates the result shape, invalidates cache on publish and logs.

type ImportGpxBody = z.output<typeof importGpxBodySchema>;

// ---- Commands ----

export async function createRoute(supabase: SupabaseClient, editionId: string, body: JsonObject, idempotencyKey: string | null) {
  const result = await callRpc(supabase, "create_route", { p_edition_id: editionId, p_input: body, p_idempotency_key: idempotencyKey }, routeSchema);
  logEvent("info", "route_created", { route_id: result.route_id, edition_id: result.edition_id });
  return result;
}

export async function createManualRevision(supabase: SupabaseClient, routeId: string, body: JsonObject, idempotencyKey: string | null) {
  return callRpc(
    supabase,
    "create_manual_revision",
    { p_route_id: routeId, p_input: body, p_idempotency_key: idempotencyKey },
    routeRevisionSchema,
  );
}

export async function importGpxRevision(supabase: SupabaseClient, routeId: string, body: ImportGpxBody, idempotencyKey: string | null) {
  // SEC-100/101: bytes are parsed and hardened entirely in this process (gpx-parser.ts) before any
  // network call; the DB command re-validates every coordinate again (defense in depth, SEC-006).
  const { geometry, pois } = parseGpxSafely(body.gpx_base64);
  const result = await callRpc(
    supabase,
    "import_gpx_revision",
    { p_route_id: routeId, p_input: { geometry, pois, source_filename: body.source_filename }, p_idempotency_key: idempotencyKey },
    routeRevisionSchema,
  );
  logEvent("info", "route_gpx_imported", { route_id: routeId, route_revision_id: result.route_revision_id, point_count: geometry.coordinates.length });
  return result;
}

export async function updateRevision(supabase: SupabaseClient, revisionId: string, body: JsonObject) {
  return callRpc(supabase, "update_revision", { p_route_revision_id: revisionId, p_input: body }, routeRevisionSchema);
}

export async function validateRevision(supabase: SupabaseClient, revisionId: string) {
  return callRpc(supabase, "validate_revision", { p_route_revision_id: revisionId }, validationResultSchema);
}

// Cache invalidation is the caller's job (invalidation.ts: "call from route handlers or workers
// after the command committed") — this stays a plain RPC call so it can run outside a Next.js
// request context too (e.g. tests/integration calling the service layer directly).
export async function publishRevision(supabase: SupabaseClient, revisionId: string, idempotencyKey: string | null) {
  const result = await callRpc(supabase, "publish_revision", { p_route_revision_id: revisionId, p_idempotency_key: idempotencyKey }, routeRevisionSchema);
  logEvent("info", "route_revision_published", { route_id: result.route_id, route_revision_id: result.route_revision_id, edition_id: result.edition_id });
  return result;
}

export async function duplicateRoute(supabase: SupabaseClient, routeId: string, body: JsonObject, idempotencyKey: string | null) {
  return callRpc(supabase, "duplicate_route", { p_route_id: routeId, p_input: body, p_idempotency_key: idempotencyKey }, routeSchema);
}

// ---- Admin reads ----

export async function adminListRoutes(supabase: SupabaseClient, editionId: string) {
  return callRpc(supabase, "admin_list_routes", { p_edition_id: editionId }, routeListSchema);
}

export async function adminGetRoute(supabase: SupabaseClient, routeId: string) {
  return callRpc(supabase, "admin_get_route", { p_route_id: routeId }, routeWithRevisionsSchema);
}

export async function adminGetRouteRevision(supabase: SupabaseClient, revisionId: string) {
  return callRpc(supabase, "admin_get_route_revision", { p_route_revision_id: revisionId }, routeRevisionSchema);
}

// ---- Public read (F1 event page, via T31 discovery; also usable server-side by any other domain) ----

export async function getEditionRoutes(supabase: SupabaseClient, editionId: string) {
  return callRpc(supabase, "get_edition_routes", { p_edition_id: editionId }, publicRouteListSchema);
}
