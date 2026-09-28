import { invalidateCache } from "@/lib/server/cache/invalidation";
import { editionIdParamSchema, updateEditionBodySchema } from "@/lib/server/domain/events/contracts";
import { adminGetEditionEditor, updateEdition } from "@/lib/server/domain/events/service";
import { defineRoute } from "@/lib/server/http/handler";

// Master §169: the full editor projection (edition + availability + readiness + every sub-resource).
export const GET = defineRoute(
  { auth: { staff: ["ADMIN", "OPERATOR"], editionParam: "editionId" }, input: { params: editionIdParamSchema } },
  async ({ supabase, input }) => ({ data: await adminGetEditionEditor(supabase, input.params.editionId) }),
);

// Non-state fields only (Master §32); registration_mode/window need EDITION_LIFECYCLE_MANAGE
// (ADMIN only) inside the command, everything else EVENT_CONTENT_MANAGE (ADMIN, OPERATOR). A slug
// change needs the historical-slug redirect data refreshed too (Master §59), same tags either way.
export const PATCH = defineRoute(
  { auth: { staff: ["ADMIN", "OPERATOR"], editionParam: "editionId" }, input: { params: editionIdParamSchema, body: updateEditionBodySchema } },
  async ({ supabase, input }) => {
    const result = await updateEdition(supabase, input.params.editionId, input.body);
    if (result.changed_fields.length > 0) {
      const type = result.changed_fields.includes("slug") ? "EditionSlugChanged" : "EditionUpdated";
      invalidateCache([{ type, editionId: input.params.editionId }]);
    }
    return { data: result };
  },
);
