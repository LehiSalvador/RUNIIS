import { acceptAccountLegalDocuments } from "@/lib/server/domain/auth/service";
import { defineRoute } from "@/lib/server/http/handler";
import { acceptAccountLegalBodySchema } from "@/lib/shared/legal";

// POST /api/v1/me/legal/accept (OWN-05): re-acceptance of the CURRENT TERMS_OF_SERVICE / PRIVACY_NOTICE.
// Body: the version ids the client displayed; a stale id fails with LEGAL_ACCEPTANCE_REQUIRED
// (details.reason VERSION_NOT_CURRENT + the current ids). Naturally idempotent (an accepted version is never
// inserted twice), so no Idempotency-Key. Rate limited (legal.account.accept); audited by the command.
export const POST = defineRoute(
  { auth: "authenticated", input: { body: acceptAccountLegalBodySchema } },
  async ({ supabase, input }) => ({
    data: await acceptAccountLegalDocuments(supabase, input.body.legal_document_version_ids),
  }),
);
