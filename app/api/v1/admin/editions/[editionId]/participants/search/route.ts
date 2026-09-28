import { z } from "zod";
import { participantSearchQuerySchema } from "@/lib/server/domain/raceday/contracts";
import { participantSearch } from "@/lib/server/domain/raceday/service";
import { defineRoute } from "@/lib/server/http/handler";

const paramsSchema = z.strictObject({ editionId: z.guid() });

// PARTICIPANT_LOOKUP (ADMIN, OPERATOR, CHECKIN). SEC-024: >=3 chars (validated again in the DB), minimal
// fields, Edition-scoped, rate-limited and audited.
export const GET = defineRoute(
  { auth: { staff: ["ADMIN", "OPERATOR", "CHECKIN"], editionParam: "editionId" }, input: { params: paramsSchema, query: participantSearchQuerySchema } },
  async ({ supabase, input }) => ({ data: await participantSearch(supabase, input.params.editionId, input.query.q) }),
);
