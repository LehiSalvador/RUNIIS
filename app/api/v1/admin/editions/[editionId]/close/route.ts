import { closeEditionBodySchema, editionIdParamSchema } from "@/lib/server/domain/closure/contracts";
import { closeEdition } from "@/lib/server/domain/closure/service";
import { defineRoute } from "@/lib/server/http/handler";

// Master §97, §175. EDITION_CLOSURE_MANAGE (ADMIN only). Creates the AdministrativeClosure and the DistanceCredits in one
// transaction. Exactly once: a concurrent or repeated close with another key answers 409 CONFLICT, the same key replays the
// stored response. No public cache tag changes here: credits feed rankings/profiles, which the ranking domain invalidates
// when it consumes the DistanceCreditGranted outbox events.
export const POST = defineRoute(
  {
    auth: { staff: ["ADMIN"], editionParam: "editionId" },
    input: { params: editionIdParamSchema, body: closeEditionBodySchema },
    idempotency: "required",
  },
  async ({ supabase, input, idempotency }) => ({
    data: await closeEdition(supabase, input.params.editionId, idempotency.key),
  }),
);
