import { z } from "zod";
import { invalidateCache } from "@/lib/server/cache/invalidation";
import { legalVersionIdParamSchema } from "@/lib/server/domain/events/contracts";
import { publishLegalDocumentVersion } from "@/lib/server/domain/events/service";
import { defineRoute } from "@/lib/server/http/handler";

// LEGAL_DOCUMENTS_PUBLISH is GLOBAL only. DRAFT -> PUBLISHED; the previous PUBLISHED version of the
// same document becomes SUPERSEDED (Master §123). The public GET /api/v1/legal/:documentKey read is
// cached (app/(public)/_lib/data.ts's cachedLegalDocument) under the shared `legal` tag.
export const POST = defineRoute(
  { auth: { staff: ["ADMIN"] }, input: { params: legalVersionIdParamSchema, body: z.strictObject({}) }, idempotency: "optional" },
  async ({ supabase, input, idempotency }) => {
    const result = await publishLegalDocumentVersion(supabase, input.params.versionId, idempotency?.key ?? null);
    invalidateCache([{ type: "LegalDocumentPublished" }]);
    return { data: result };
  },
);
