import { editionIdParamSchema, hideEditionBodySchema } from "@/lib/server/domain/events/contracts";
import { transitionEdition } from "@/lib/server/domain/events/service";
import { defineRoute } from "@/lib/server/http/handler";

// EDITION_PUBLISH (ADMIN only).
export const POST = defineRoute(
  { auth: { staff: ["ADMIN"], editionParam: "editionId" }, input: { params: editionIdParamSchema, body: hideEditionBodySchema }, idempotency: "optional" },
  async ({ supabase, input, idempotency }) => ({
    data: await transitionEdition(supabase, "hide", input.params.editionId, input.body, idempotency?.key ?? null),
  }),
);
