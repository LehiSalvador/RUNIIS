import { creditLedgerQuerySchema, editionIdParamSchema } from "@/lib/server/domain/closure/contracts";
import { listDistanceCredits } from "@/lib/server/domain/closure/service";
import { defineRoute } from "@/lib/server/http/handler";

// P3-T (Master §99, §175): the Edition's DistanceCredit ledger (registration, participant label, modality, official and credited distance,
// sport_date, ACTIVE/REVERSED, reversal, supersedes chain), ordered by closure revision (newest first) then registration number, keyset-paginated.
// ATTENDANCE_MANAGE on the Edition (ADMIN, OPERATOR; Edition scope re-checked by the database). Read-only. Participant labels are the profile
// display name only: no contact fields, so contact PII (PII_EXPORT) never travels here. `meta` = { next_cursor, total, summary } where `summary`
// is the Edition-wide ACTIVE credited distance (total and per modality), independent of the filters.
export const GET = defineRoute(
  {
    auth: { staff: ["ADMIN", "OPERATOR"], editionParam: "editionId" },
    input: { params: editionIdParamSchema, query: creditLedgerQuerySchema },
  },
  async ({ supabase, input }) => {
    const page = await listDistanceCredits(supabase, input.params.editionId, input.query);
    return { data: page.items, meta: { next_cursor: page.nextCursor, total: page.total, summary: page.summary } };
  },
);
