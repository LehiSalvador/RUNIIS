import { formIdParamSchema } from "@/lib/server/domain/events/contracts";
import { deleteRegistrationForm } from "@/lib/server/domain/events/service";
import { defineRoute } from "@/lib/server/http/handler";

// EVENT_CONTENT_MANAGE. DRAFT forms only (protect_versioned_status).
export const DELETE = defineRoute(
  { auth: { staff: ["ADMIN", "OPERATOR"] }, input: { params: formIdParamSchema } },
  async ({ supabase, input }) => ({ data: await deleteRegistrationForm(supabase, input.params.formId) }),
);
