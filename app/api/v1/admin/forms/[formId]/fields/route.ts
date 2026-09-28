import { formIdParamSchema, replaceFormFieldsBodySchema } from "@/lib/server/domain/events/contracts";
import { replaceRegistrationFormFields } from "@/lib/server/domain/events/service";
import { defineRoute } from "@/lib/server/http/handler";

// EVENT_CONTENT_MANAGE. Fields change only while the form is DRAFT (Master §41).
export const PUT = defineRoute(
  { auth: { staff: ["ADMIN", "OPERATOR"] }, input: { params: formIdParamSchema, body: replaceFormFieldsBodySchema } },
  async ({ supabase, input }) => ({ data: await replaceRegistrationFormFields(supabase, input.params.formId, input.body) }),
);
