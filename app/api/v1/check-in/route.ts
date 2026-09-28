import { checkInScanBodySchema } from "@/lib/server/domain/raceday/contracts";
import { checkInScan } from "@/lib/server/domain/raceday/service";
import { defineRoute } from "@/lib/server/http/handler";

// PASS_SCAN (ADMIN, OPERATOR, CHECKIN). Always 200 + `outcome` (Master §85, §174); the DB derives the
// real scope from the scanned pass and compares it against edition_id (SEC-020, WRONG_EVENT).
export const POST = defineRoute(
  { auth: { staff: ["ADMIN", "OPERATOR", "CHECKIN"] }, input: { body: checkInScanBodySchema } },
  async ({ supabase, input }) => ({
    data: await checkInScan(supabase, input.body.edition_id, input.body.credential_token, input.body.station_key ?? null),
  }),
);
