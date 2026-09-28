import { editionIdParamSchema, setEditionScheduleBodySchema } from "@/lib/server/domain/events/contracts";
import { setEditionSchedule } from "@/lib/server/domain/events/service";
import { defineRoute } from "@/lib/server/http/handler";

// DRAFT: EVENT_CONTENT_MANAGE (ADMIN, OPERATOR). Published: only the time on the same date, and only
// EDITION_LIFECYCLE_MANAGE (ADMIN) — a date move needs /postpone or /reschedule (Master §29).
export const POST = defineRoute(
  { auth: { staff: ["ADMIN", "OPERATOR"], editionParam: "editionId" }, input: { params: editionIdParamSchema, body: setEditionScheduleBodySchema } },
  async ({ supabase, input }) => ({ data: await setEditionSchedule(supabase, input.params.editionId, input.body) }),
);
