import { listScannerEditions } from "@/lib/server/domain/raceday/service";
import { defineRoute } from "@/lib/server/http/handler";

// PASS_SCAN (ADMIN, OPERATOR, CHECKIN). The Editions the caller may operate at a station, per Edition scope:
// published or hidden (never DRAFT) and still to be run (SCHEDULED or IN_PROGRESS). The admin Editions list
// is gated by EVENT_CONTENT_MANAGE and answers nothing for CHECKIN, so the scanner reads this one instead.
export const GET = defineRoute({ auth: { staff: ["ADMIN", "OPERATOR", "CHECKIN"] } }, async ({ supabase }) => ({
  data: await listScannerEditions(supabase),
}));
