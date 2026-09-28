import { createRegistrationFormBodySchema, editionIdParamSchema } from "@/lib/server/domain/events/contracts";
import { createRegistrationForm } from "@/lib/server/domain/events/service";
import { defineRoute } from "@/lib/server/http/handler";

// EVENT_CONTENT_MANAGE (ADMIN, OPERATOR), Master §41.
export const POST = defineRoute(
  {
    auth: { staff: ["ADMIN", "OPERATOR"], editionParam: "editionId" },
    input: { params: editionIdParamSchema, body: createRegistrationFormBodySchema },
  },
  async ({ supabase, input }) => ({ data: await createRegistrationForm(supabase, input.params.editionId, input.body), status: 201 }),
);
