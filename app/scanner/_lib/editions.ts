import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hasRoleForEdition, type StaffAssignment, type StaffRole } from "@/components/admin/access";
import { formatCalendarDate } from "@/components/admin/format";
import type { ScannerEdition } from "@/components/scanner/scanner-app";
import { searchEditions } from "@/lib/server/domain/discovery/service";
import { adminListEditions } from "@/lib/server/domain/events/service";
import { settle } from "@/app/admin/_lib/session";

const CATALOGUE_PAGES = 6;

/** Roles that may use the scanner (PASS_SCAN / KIT_PICKUP_RECORD / PARTICIPANT_LOOKUP): the same list the API routes authorise. */
export const SCANNER_ROLES: readonly StaffRole[] = ["ADMIN", "OPERATOR", "CHECKIN"];

/**
 * Editions the staff member can open the scanner on. ADMIN/OPERATOR read them through the staff list (the database narrows the rows to
 * their scope). CHECKIN holds no event-configuration permission, so that read yields nothing for them: the staff list gives nothing for
 * CHECKIN, so the names come from the public catalogue (published Editions only) and the choice is narrowed to the Editions the
 * assignments cover (GLOBAL covers all). An Edition the API will refuse is never offered; the API still re-authorises every scan.
 * Finished and canceled Editions are not offered.
 */
export async function loadScannerEditions(supabase: SupabaseClient, assignments: readonly StaffAssignment[]): Promise<ScannerEdition[]> {
  const byId = new Map<string, ScannerEdition>();
  const add = (id: string, name: string, date: string | null, city: string, execution: string) => {
    if (execution === "FINISHED" || execution === "CANCELED") return;
    if (!hasRoleForEdition(assignments, SCANNER_ROLES, id)) return;
    byId.set(id, { id, name, detail: [date ? formatCalendarDate(date) : null, city].filter(Boolean).join(" · ") || null });
  };

  const staff = await settle(adminListEditions(supabase, { limit: 100 }), "scanner.editions");
  if (staff.ok) for (const item of staff.data.items) add(item.edition_id, item.name, item.sport_date, item.city, item.execution_state);

  if (byId.size === 0) {
    // The public catalogue is paged: walk it (bounded) so an Edition far down the date order is still offered.
    let cursor: string | undefined;
    for (let page = 0; page < CATALOGUE_PAGES; page++) {
      const catalogue = await settle(searchEditions({ limit: 50, cursor }), "scanner.editions_public");
      if (!catalogue.ok) break;
      for (const item of catalogue.data.items) add(item.edition_id, item.name, item.sport_date, item.city, item.execution_state);
      if (!catalogue.data.nextCursor) break;
      cursor = catalogue.data.nextCursor;
    }
  }
  return [...byId.values()];
}
