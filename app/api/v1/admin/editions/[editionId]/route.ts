import { editionIdParamSchema, updateEditionBodySchema } from "@/lib/server/domain/events/contracts";
import { adminGetEditionEditor, updateEdition } from "@/lib/server/domain/events/service";
import { defineRoute } from "@/lib/server/http/handler";

// Master §169: the full editor projection (edition + availability + readiness + every sub-resource).
export const GET = defineRoute(
  { auth: { staff: ["ADMIN", "OPERATOR"], editionParam: "editionId" }, input: { params: editionIdParamSchema } },
  async ({ supabase, input }) => ({ data: await adminGetEditionEditor(supabase, input.params.editionId) }),
);

// Non-state fields only (Master §32); registration_mode/window need EDITION_LIFECYCLE_MANAGE
// (ADMIN only) inside the command, everything else EVENT_CONTENT_MANAGE (ADMIN, OPERATOR).
export const PATCH = defineRoute(
  { auth: { staff: ["ADMIN", "OPERATOR"], editionParam: "editionId" }, input: { params: editionIdParamSchema, body: updateEditionBodySchema } },
  async ({ supabase, input }) => ({ data: await updateEdition(supabase, input.params.editionId, input.body) }),
);
