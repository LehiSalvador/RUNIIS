import { legalVersionIdParamSchema, updateLegalVersionBodySchema } from "@/lib/server/domain/events/contracts";
import { adminGetLegalDocumentVersion, updateLegalDocumentVersion } from "@/lib/server/domain/events/service";
import { defineRoute } from "@/lib/server/http/handler";

// LEGAL_DOCUMENTS_PUBLISH is GLOBAL only.
export const GET = defineRoute(
  { auth: { staff: ["ADMIN"] }, input: { params: legalVersionIdParamSchema } },
  async ({ supabase, input }) => ({ data: await adminGetLegalDocumentVersion(supabase, input.params.versionId) }),
);

// DRAFT versions only (protect_versioned_status).
export const PATCH = defineRoute(
  { auth: { staff: ["ADMIN"] }, input: { params: legalVersionIdParamSchema, body: updateLegalVersionBodySchema } },
  async ({ supabase, input }) => ({ data: await updateLegalDocumentVersion(supabase, input.params.versionId, input.body) }),
);
