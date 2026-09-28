import { campaignIdParamSchema } from "@/lib/server/domain/communications/contracts";
import { previewCommunicationCampaign } from "@/lib/server/domain/communications/admin-service";
import { defineRoute } from "@/lib/server/http/handler";

// POST /api/v1/admin/communications/campaigns/:campaignId/preview: locks the campaign, computes the
// live candidate count (DRAFT -> READY) and returns a rendered sample (Master §134).
export const POST = defineRoute({ auth: { staff: ["ADMIN", "OPERATOR"] }, input: { params: campaignIdParamSchema } }, async ({ supabase, input }) => {
  return { data: await previewCommunicationCampaign(supabase, input.params.campaignId) };
});
