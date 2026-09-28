import { z } from "zod";
import { legalVersionIdParamSchema } from "@/lib/server/domain/events/contracts";
import { publishLegalDocumentVersion } from "@/lib/server/domain/events/service";
import { defineRoute } from "@/lib/server/http/handler";

// LEGAL_DOCUMENTS_PUBLISH is GLOBAL only. DRAFT -> PUBLISHED; the previous PUBLISHED version of the
// same document becomes SUPERSEDED (Master §123).
export const POST = defineRoute(
  { auth: { staff: ["ADMIN"] }, input: { params: legalVersionIdParamSchema, body: z.strictObject({}) }, idempotency: "optional" },
  async ({ supabase, input, idempotency }) => ({
    data: await publishLegalDocumentVersion(supabase, input.params.versionId, idempotency?.key ?? null),
  }),
);
