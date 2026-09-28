import { createLegalVersionBodySchema, legalDocumentIdParamSchema } from "@/lib/server/domain/events/contracts";
import { createLegalDocumentVersion } from "@/lib/server/domain/events/service";
import { defineRoute } from "@/lib/server/http/handler";

// LEGAL_DOCUMENTS_PUBLISH is GLOBAL only. New DRAFT version of an ACTIVE document.
export const POST = defineRoute(
  { auth: { staff: ["ADMIN"] }, input: { params: legalDocumentIdParamSchema, body: createLegalVersionBodySchema } },
  async ({ supabase, input }) => ({ data: await createLegalDocumentVersion(supabase, input.params.documentId, input.body), status: 201 }),
);
