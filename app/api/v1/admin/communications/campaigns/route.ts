import { createCampaignBodySchema, listCampaignsQuerySchema } from "@/lib/server/domain/communications/contracts";
import { createCommunicationCampaign, listCommunicationCampaigns } from "@/lib/server/domain/communications/admin-service";
import { defineRoute } from "@/lib/server/http/handler";

// GET/POST /api/v1/admin/communications/campaigns (Master §134-135, §176). CAMPAIGN_MANAGE (MARKETING)
// or COMMUNICATION_OPERATIONAL_SEND (OPERATIONAL) is re-checked by campaign type inside the command;
// this staff gate is only the early reject (CHECKIN/MODERATOR hold neither permission).
export const GET = defineRoute({ auth: { staff: ["ADMIN", "OPERATOR"] }, input: { query: listCampaignsQuerySchema } }, async ({ supabase, input }) => {
  const page = await listCommunicationCampaigns(supabase, input.query);
  return { data: page.items, meta: { has_more: page.has_more } };
});

export const POST = defineRoute(
  { auth: { staff: ["ADMIN", "OPERATOR"] }, input: { body: createCampaignBodySchema }, idempotency: "optional" },
  async ({ supabase, input, idempotency }) => ({
    data: await createCommunicationCampaign(supabase, input.body, idempotency?.key ?? null),
    status: 201,
  }),
);
