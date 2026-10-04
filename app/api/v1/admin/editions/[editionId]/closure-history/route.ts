import { closureHistoryQuerySchema, editionIdParamSchema } from "@/lib/server/domain/closure/contracts";
import { listClosureHistory, listFinalizationHistory } from "@/lib/server/domain/closure/service";
import { defineRoute } from "@/lib/server/http/handler";

// P3-T (Master §94-98, §175): the auditable revision history of the Edition's attendance finalization (`kind=FINALIZATION`) or administrative
// closure (`kind=CLOSURE`), newest revision first, keyset-paginated. ATTENDANCE_MANAGE on the Edition (ADMIN, OPERATOR; an Edition-scoped
// operator only for their Edition, the database re-checks). Read-only: it never reconciles the attendance universe, so unlike the workspace it
// is safe to call without the explicit-request guard. `meta` = { next_cursor, total }; never cached (staff labels depend on the viewer).
export const GET = defineRoute(
  {
    auth: { staff: ["ADMIN", "OPERATOR"], editionParam: "editionId" },
    input: { params: editionIdParamSchema, query: closureHistoryQuerySchema },
  },
  async ({ supabase, input }) => {
    const { kind, ...filters } = input.query;
    const page =
      kind === "FINALIZATION"
        ? await listFinalizationHistory(supabase, input.params.editionId, filters)
        : await listClosureHistory(supabase, input.params.editionId, filters);
    return { data: page.items, meta: { next_cursor: page.nextCursor, total: page.total } };
  },
);
