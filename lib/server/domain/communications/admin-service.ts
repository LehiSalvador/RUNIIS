import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { callRpc } from "../../rpc";
import {
  campaignProjectionSchema,
  communicationMetricsSchema,
  listCampaignsResultSchema,
  listMessagesResultSchema,
  previewCampaignResultSchema,
  sendCampaignResultSchema,
} from "./contracts";

// Admin console for campaigns (Master §134-135, §176): permission (CAMPAIGN_MANAGE /
// COMMUNICATION_OPERATIONAL_SEND by campaign type) and Edition scoping are enforced inside every
// command; these are thin RPC wrappers only.

export const createCommunicationCampaign = (
  supabase: SupabaseClient,
  body: { campaign_type: "MARKETING" | "OPERATIONAL"; template_key: string; edition_id: string; audience: Record<string, unknown>; template_variables: Record<string, unknown> },
  idempotencyKey: string | null,
) =>
  callRpc(
    supabase,
    "create_communication_campaign",
    {
      p_campaign_type: body.campaign_type,
      p_template_key: body.template_key,
      p_edition_id: body.edition_id,
      p_audience: body.audience,
      p_template_variables: body.template_variables,
      p_idempotency_key: idempotencyKey,
    },
    campaignProjectionSchema,
  );

export const previewCommunicationCampaign = (supabase: SupabaseClient, campaignId: string) =>
  callRpc(supabase, "preview_communication_campaign", { p_campaign_id: campaignId }, previewCampaignResultSchema);

export const scheduleCommunicationCampaign = (supabase: SupabaseClient, campaignId: string, scheduledFor: string) =>
  callRpc(supabase, "schedule_communication_campaign", { p_campaign_id: campaignId, p_scheduled_for: scheduledFor }, campaignProjectionSchema);

export const sendCommunicationCampaign = (supabase: SupabaseClient, campaignId: string, idempotencyKey: string | null) =>
  callRpc(supabase, "send_communication_campaign", { p_campaign_id: campaignId, p_idempotency_key: idempotencyKey }, sendCampaignResultSchema);

export const cancelCommunicationCampaign = (supabase: SupabaseClient, campaignId: string, reason: string | null) =>
  callRpc(supabase, "cancel_communication_campaign", { p_campaign_id: campaignId, p_reason: reason }, campaignProjectionSchema);

export const listCommunicationCampaigns = (
  supabase: SupabaseClient,
  query: { edition_id?: string; status?: string; before_created_at?: string; before_id?: string; limit?: number },
) =>
  callRpc(
    supabase,
    "list_communication_campaigns",
    {
      p_edition_id: query.edition_id ?? null,
      p_status: query.status ?? null,
      p_before_created_at: query.before_created_at ?? null,
      p_before_id: query.before_id ?? null,
      p_limit: query.limit ?? null,
    },
    listCampaignsResultSchema,
  );

export const listCommunicationMessages = (
  supabase: SupabaseClient,
  query: { edition_id?: string; campaign_id?: string; status?: string; template_key?: string; before_created_at?: string; before_id?: string; limit?: number },
) =>
  callRpc(
    supabase,
    "list_communication_messages",
    {
      p_edition_id: query.edition_id ?? null,
      p_campaign_id: query.campaign_id ?? null,
      p_status: query.status ?? null,
      p_template_key: query.template_key ?? null,
      p_before_created_at: query.before_created_at ?? null,
      p_before_id: query.before_id ?? null,
      p_limit: query.limit ?? null,
    },
    listMessagesResultSchema,
  );

export const getCommunicationMetrics = (supabase: SupabaseClient) => callRpc(supabase, "get_communication_metrics", {}, communicationMetricsSchema);
