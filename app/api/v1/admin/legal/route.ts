import { createLegalDocumentBodySchema } from "@/lib/server/domain/events/contracts";
import { adminListLegalDocuments, createLegalDocument } from "@/lib/server/domain/events/service";
import { defineRoute } from "@/lib/server/http/handler";

// LEGAL_DOCUMENTS_PUBLISH is GLOBAL only (Master §123).
export const GET = defineRoute({ auth: { staff: ["ADMIN"] } }, async ({ supabase }) => ({ data: await adminListLegalDocuments(supabase) }));

export const POST = defineRoute(
  { auth: { staff: ["ADMIN"] }, input: { body: createLegalDocumentBodySchema } },
  async ({ supabase, input }) => ({ data: await createLegalDocument(supabase, input.body), status: 201 }),
);
