import { campaignIdParamSchema } from "@/lib/server/domain/communications/contracts";
import { sendCommunicationCampaign } from "@/lib/server/domain/communications/admin-service";
import { defineRoute } from "@/lib/server/http/handler";

// POST /api/v1/admin/communications/campaigns/:campaignId/send (Master §134-135, §195: non-production
// never sends campaigns — enforced by the delivery-mode gate at dispatch time, not here).
export const POST = defineRoute(
  { auth: { staff: ["ADMIN", "OPERATOR"] }, input: { params: campaignIdParamSchema }, idempotency: "optional" },
  async ({ supabase, input, idempotency }) => ({ data: await sendCommunicationCampaign(supabase, input.params.campaignId, idempotency?.key ?? null) }),
);
