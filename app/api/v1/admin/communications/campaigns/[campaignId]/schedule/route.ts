import { campaignIdParamSchema, scheduleCampaignBodySchema } from "@/lib/server/domain/communications/contracts";
import { scheduleCommunicationCampaign } from "@/lib/server/domain/communications/admin-service";
import { defineRoute } from "@/lib/server/http/handler";

// POST /api/v1/admin/communications/campaigns/:campaignId/schedule (Master §134-135).
export const POST = defineRoute(
  { auth: { staff: ["ADMIN", "OPERATOR"] }, input: { params: campaignIdParamSchema, body: scheduleCampaignBodySchema } },
  async ({ supabase, input }) => ({ data: await scheduleCommunicationCampaign(supabase, input.params.campaignId, input.body.scheduled_for) }),
);
