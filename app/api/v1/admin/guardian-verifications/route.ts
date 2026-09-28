import { guardianListQuerySchema } from "@/lib/server/domain/raceday/contracts";
import { listGuardianVerifications } from "@/lib/server/domain/raceday/service";
import { defineRoute } from "@/lib/server/http/handler";

// GUARDIAN_VERIFY (ADMIN, OPERATOR, CHECKIN). PENDING and REJECTED entries for the Edition's Guardian desk.
export const GET = defineRoute(
  { auth: { staff: ["ADMIN", "OPERATOR", "CHECKIN"] }, input: { query: guardianListQuerySchema } },
  async ({ supabase, input }) => ({ data: await listGuardianVerifications(supabase, input.query.edition_id) }),
);
