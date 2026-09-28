import { acceptDocumentsBodySchema } from "@/lib/server/domain/registration/contracts";
import { acceptEditionDocuments } from "@/lib/server/domain/registration/service";
import { defineRoute } from "@/lib/server/http/handler";

export const POST = defineRoute({ auth: "ready", input: { body: acceptDocumentsBodySchema } }, async ({ supabase, input }) => ({
  data: await acceptEditionDocuments(
    supabase,
    input.body.edition_id,
    input.body.legal_document_version_ids,
    input.body.minor_public_profile_id,
    input.body.minor_guest_participant_id,
  ),
}));
