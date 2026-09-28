import { createScheduleItemBodySchema, editionIdParamSchema } from "@/lib/server/domain/events/contracts";
import { createScheduleItem } from "@/lib/server/domain/events/service";
import { defineRoute } from "@/lib/server/http/handler";

// EVENT_CONTENT_MANAGE (ADMIN, OPERATOR), Master §44.
export const POST = defineRoute(
  { auth: { staff: ["ADMIN", "OPERATOR"], editionParam: "editionId" }, input: { params: editionIdParamSchema, body: createScheduleItemBodySchema } },
  async ({ supabase, input }) => ({ data: await createScheduleItem(supabase, input.params.editionId, input.body), status: 201 }),
);
