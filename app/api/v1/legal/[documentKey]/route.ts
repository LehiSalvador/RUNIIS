import { documentKeyParamSchema } from "@/lib/server/domain/events/contracts";
import { getPublicLegalDocument } from "@/lib/server/domain/events/service";
import { AppError } from "@/lib/server/http/errors";
import { defineRoute } from "@/lib/server/http/handler";
import { createAnonClient } from "@/lib/server/supabase/clients";

// Public (Master §165): the current PUBLISHED version of an ACTIVE document, or 404.
export const GET = defineRoute({ auth: "public", input: { params: documentKeyParamSchema } }, async ({ input }) => {
  const document = await getPublicLegalDocument(createAnonClient(), input.params.documentKey);
  if (!document) throw new AppError("NOT_FOUND");
  return { data: document };
});
