import { invalidateCache } from "@/lib/server/cache/invalidation";
import { modalityIdParamSchema, updateModalityBodySchema } from "@/lib/server/domain/events/contracts";
import { deleteModality, updateModality } from "@/lib/server/domain/events/service";
import { defineRoute } from "@/lib/server/http/handler";

// MODALITY_MANAGE; the Edition scope comes from the target Modality (SEC-020).
export const PATCH = defineRoute(
  { auth: { staff: ["ADMIN", "OPERATOR"] }, input: { params: modalityIdParamSchema, body: updateModalityBodySchema } },
  async ({ supabase, input }) => {
    const result = await updateModality(supabase, input.params.modalityId, input.body);
    invalidateCache([{ type: "EditionContentChanged", editionId: result.edition_id }]);
    return { data: result };
  },
);

// DRAFT Editions only: a published modality is closed or canceled instead (status endpoint).
export const DELETE = defineRoute(
  { auth: { staff: ["ADMIN", "OPERATOR"] }, input: { params: modalityIdParamSchema } },
  async ({ supabase, input }) => {
    const result = await deleteModality(supabase, input.params.modalityId);
    invalidateCache([{ type: "EditionContentChanged", editionId: result.edition_id }]);
    return { data: result };
  },
);
