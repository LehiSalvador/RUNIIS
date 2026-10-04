import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StaffRole } from "@/components/admin/access";
import type { ScannerEdition } from "@/components/scanner/scanner-app";
import { scannerEditionDetail } from "@/components/scanner/session";
import { settle, type Loaded } from "@/app/admin/_lib/session";
import { listScannerEditions } from "@/lib/server/domain/raceday/service";

/** Roles that may use the scanner (PASS_SCAN / KIT_PICKUP_RECORD / PARTICIPANT_LOOKUP): the same list the API routes authorise. */
export const SCANNER_ROLES: readonly StaffRole[] = ["ADMIN", "OPERATOR", "CHECKIN"];

/**
 * Editions the staff member can open the scanner on: exactly what `GET /api/v1/scanner/editions` answers (the same service the route
 * calls). The database narrows it by PASS_SCAN scope, so a GLOBAL role lists every operable Edition and an EDITION-scoped role only
 * its own, for CHECKIN as for ADMIN and OPERATOR; DRAFT, postponed, finished and canceled Editions are never offered. No other source is
 * consulted: a failed read is reported as a failure (never as "no editions"), and the API still re-authorises every scan.
 */
export async function loadScannerEditions(supabase: SupabaseClient): Promise<Loaded<ScannerEdition[]>> {
  const result = await settle(listScannerEditions(supabase), "scanner.editions");
  if (!result.ok) return result;
  return { ok: true, data: result.data.map((row) => ({ id: row.edition_id, name: row.name, detail: scannerEditionDetail(row) })) };
}
