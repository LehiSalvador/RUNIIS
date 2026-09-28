import { campaignIdParamSchema, cancelCampaignBodySchema } from "@/lib/server/domain/communications/contracts";
import { cancelCommunicationCampaign } from "@/lib/server/domain/communications/admin-service";
import { defineRoute } from "@/lib/server/http/handler";

// POST /api/v1/admin/communications/campaigns/:campaignId/cancel (Master §134-135).
export const POST = defineRoute(
  { auth: { staff: ["ADMIN", "OPERATOR"] }, input: { params: campaignIdParamSchema, body: cancelCampaignBodySchema } },
  async ({ supabase, input }) => ({ data: await cancelCommunicationCampaign(supabase, input.params.campaignId, input.body.reason ?? null) }),
);
