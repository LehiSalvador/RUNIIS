-- Public facades and grants for T35 communications commands (ADR-001 §2/§6b pattern). Every function
-- below is created without a wrapper in 153-155; this migration is the only place client/worker access
-- is opened. Internal helpers (comms_*) are never wrapped: they stay unreachable from PostgREST.

-- ---------------------------------------------------------------------------------------------
-- Self-service (authenticated): favorites, reminders, preferences (Master §176).
-- ---------------------------------------------------------------------------------------------

create function public.add_edition_favorite(p_edition_id uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.add_edition_favorite(p_edition_id) $$;

create function public.remove_edition_favorite(p_edition_id uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.remove_edition_favorite(p_edition_id) $$;

create function public.list_my_favorites()
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.list_my_favorites() $$;

create function public.create_edition_reminder(p_edition_id uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.create_edition_reminder(p_edition_id) $$;

create function public.cancel_reminder(p_reminder_id uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.cancel_reminder(p_reminder_id) $$;

create function public.get_my_communication_preferences()
returns jsonb language sql security invoker set search_path = ''
as $$ select private.get_my_communication_preferences() $$;

create function public.update_my_communication_preferences(
  p_general_marketing boolean, p_event_reminder boolean, p_other_optional boolean)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.update_my_communication_preferences(p_general_marketing, p_event_reminder, p_other_optional) $$;

revoke all on function
  private.add_edition_favorite(uuid), public.add_edition_favorite(uuid),
  private.remove_edition_favorite(uuid), public.remove_edition_favorite(uuid),
  private.list_my_favorites(), public.list_my_favorites(),
  private.create_edition_reminder(uuid), public.create_edition_reminder(uuid),
  private.cancel_reminder(uuid), public.cancel_reminder(uuid),
  private.get_my_communication_preferences(), public.get_my_communication_preferences(),
  private.update_my_communication_preferences(boolean, boolean, boolean), public.update_my_communication_preferences(boolean, boolean, boolean)
from public, anon, authenticated, service_role;

grant execute on function
  private.add_edition_favorite(uuid), public.add_edition_favorite(uuid),
  private.remove_edition_favorite(uuid), public.remove_edition_favorite(uuid),
  private.list_my_favorites(), public.list_my_favorites(),
  private.create_edition_reminder(uuid), public.create_edition_reminder(uuid),
  private.cancel_reminder(uuid), public.cancel_reminder(uuid),
  private.get_my_communication_preferences(), public.get_my_communication_preferences(),
  private.update_my_communication_preferences(boolean, boolean, boolean), public.update_my_communication_preferences(boolean, boolean, boolean)
to authenticated;

-- ---------------------------------------------------------------------------------------------
-- SYSTEM only (service_role): anonymous reminder request/confirm, one-click unsubscribe. Next
-- applies IP/email rate limits and CAPTCHA before calling these with the system client (SEC-082/084).
-- ---------------------------------------------------------------------------------------------

create function public.request_anonymous_reminder(p_edition_id uuid, p_email text)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.request_anonymous_reminder(p_edition_id, p_email) $$;

create function public.confirm_anonymous_reminder(p_token_hash text)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.confirm_anonymous_reminder(p_token_hash) $$;

create function public.unsubscribe_with_token(p_token_hash text)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.unsubscribe_with_token(p_token_hash) $$;

revoke all on function
  private.request_anonymous_reminder(uuid, text), public.request_anonymous_reminder(uuid, text),
  private.confirm_anonymous_reminder(text), public.confirm_anonymous_reminder(text),
  private.unsubscribe_with_token(text), public.unsubscribe_with_token(text)
from public, anon, authenticated, service_role;

grant execute on function
  private.request_anonymous_reminder(uuid, text), public.request_anonymous_reminder(uuid, text),
  private.confirm_anonymous_reminder(text), public.confirm_anonymous_reminder(text),
  private.unsubscribe_with_token(text), public.unsubscribe_with_token(text)
to service_role;

-- ---------------------------------------------------------------------------------------------
-- SYSTEM only (service_role): outbox dispatcher, message dispatcher, provider webhook, worker runs.
-- ---------------------------------------------------------------------------------------------

create function public.claim_outbox_events(p_worker text, p_event_types text[], p_limit integer, p_lease_seconds integer)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.claim_outbox_events(p_worker, p_event_types, p_limit, p_lease_seconds) $$;

create function public.complete_outbox_event(
  p_outbox_event_id uuid, p_worker text, p_outcome text, p_error_code text, p_retry_at timestamptz)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.complete_outbox_event(p_outbox_event_id, p_worker, p_outcome, p_error_code, p_retry_at) $$;

create function public.claim_communication_messages(p_worker text, p_provider text, p_limit integer, p_lease_seconds integer)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.claim_communication_messages(p_worker, p_provider, p_limit, p_lease_seconds) $$;

create function public.issue_communication_action_token(p_message_id uuid, p_worker text, p_attempt_number integer, p_token_hash text)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.issue_communication_action_token(p_message_id, p_worker, p_attempt_number, p_token_hash) $$;

create function public.record_email_provider_event(
  p_provider text, p_provider_event_id text, p_provider_message_id text, p_event_type text, p_payload_safe jsonb,
  p_authenticated boolean)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.record_email_provider_event(p_provider, p_provider_event_id, p_provider_message_id, p_event_type, p_payload_safe, p_authenticated) $$;

create function public.complete_communication_attempt(
  p_message_id uuid, p_worker text, p_attempt_number integer, p_outcome text, p_provider text,
  p_provider_message_id text, p_error_code text, p_retry_at timestamptz)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.complete_communication_attempt(p_message_id, p_worker, p_attempt_number, p_outcome, p_provider,
  p_provider_message_id, p_error_code, p_retry_at) $$;

create function public.enqueue_registration_confirmed_messages(p_outbox_event_id uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.enqueue_registration_confirmed_messages(p_outbox_event_id) $$;

create function public.enqueue_edition_event_messages(p_outbox_event_id uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.enqueue_edition_event_messages(p_outbox_event_id) $$;

create function public.start_worker_run(p_worker_key text)
returns uuid language sql security invoker set search_path = ''
as $$ select private.start_worker_run(p_worker_key) $$;

create function public.finish_worker_run(p_worker_run_id uuid, p_status text, p_processed_count integer,
  p_error_count integer, p_metadata jsonb)
returns void language sql security invoker set search_path = ''
as $$ select private.finish_worker_run(p_worker_run_id, p_status, p_processed_count, p_error_count, p_metadata) $$;

revoke all on function
  private.claim_outbox_events(text, text[], integer, integer), public.claim_outbox_events(text, text[], integer, integer),
  private.complete_outbox_event(uuid, text, text, text, timestamptz), public.complete_outbox_event(uuid, text, text, text, timestamptz),
  private.claim_communication_messages(text, text, integer, integer), public.claim_communication_messages(text, text, integer, integer),
  private.issue_communication_action_token(uuid, text, integer, text), public.issue_communication_action_token(uuid, text, integer, text),
  private.record_email_provider_event(text, text, text, text, jsonb, boolean), public.record_email_provider_event(text, text, text, text, jsonb, boolean),
  private.complete_communication_attempt(uuid, text, integer, text, text, text, text, timestamptz),
  public.complete_communication_attempt(uuid, text, integer, text, text, text, text, timestamptz),
  private.enqueue_registration_confirmed_messages(uuid), public.enqueue_registration_confirmed_messages(uuid),
  private.enqueue_edition_event_messages(uuid), public.enqueue_edition_event_messages(uuid),
  private.start_worker_run(text), public.start_worker_run(text),
  private.finish_worker_run(uuid, text, integer, integer, jsonb), public.finish_worker_run(uuid, text, integer, integer, jsonb)
from public, anon, authenticated, service_role;

grant execute on function
  private.claim_outbox_events(text, text[], integer, integer), public.claim_outbox_events(text, text[], integer, integer),
  private.complete_outbox_event(uuid, text, text, text, timestamptz), public.complete_outbox_event(uuid, text, text, text, timestamptz),
  private.claim_communication_messages(text, text, integer, integer), public.claim_communication_messages(text, text, integer, integer),
  private.issue_communication_action_token(uuid, text, integer, text), public.issue_communication_action_token(uuid, text, integer, text),
  private.record_email_provider_event(text, text, text, text, jsonb, boolean), public.record_email_provider_event(text, text, text, text, jsonb, boolean),
  private.complete_communication_attempt(uuid, text, integer, text, text, text, text, timestamptz),
  public.complete_communication_attempt(uuid, text, integer, text, text, text, text, timestamptz),
  private.enqueue_registration_confirmed_messages(uuid), public.enqueue_registration_confirmed_messages(uuid),
  private.enqueue_edition_event_messages(uuid), public.enqueue_edition_event_messages(uuid),
  private.start_worker_run(text), public.start_worker_run(text),
  private.finish_worker_run(uuid, text, integer, integer, jsonb), public.finish_worker_run(uuid, text, integer, integer, jsonb)
to service_role;

-- ---------------------------------------------------------------------------------------------
-- Admin console (authenticated; CAMPAIGN_MANAGE / COMMUNICATION_OPERATIONAL_SEND checked inside).
-- ---------------------------------------------------------------------------------------------

create function public.create_communication_campaign(
  p_campaign_type text, p_template_key text, p_edition_id uuid, p_audience jsonb, p_template_variables jsonb,
  p_idempotency_key text default null)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.create_communication_campaign(p_campaign_type, p_template_key, p_edition_id, p_audience, p_template_variables, p_idempotency_key) $$;

create function public.preview_communication_campaign(p_campaign_id uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.preview_communication_campaign(p_campaign_id) $$;

create function public.schedule_communication_campaign(p_campaign_id uuid, p_scheduled_for timestamptz)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.schedule_communication_campaign(p_campaign_id, p_scheduled_for) $$;

create function public.send_communication_campaign(p_campaign_id uuid, p_idempotency_key text default null)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.send_communication_campaign(p_campaign_id, p_idempotency_key) $$;

create function public.cancel_communication_campaign(p_campaign_id uuid, p_reason text default null)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.cancel_communication_campaign(p_campaign_id, p_reason) $$;

create function public.list_communication_campaigns(p_edition_id uuid, p_status text, p_before_created_at timestamptz,
  p_before_id uuid, p_limit integer)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.list_communication_campaigns(p_edition_id, p_status, p_before_created_at, p_before_id, p_limit) $$;

create function public.list_communication_messages(p_edition_id uuid, p_campaign_id uuid, p_status text,
  p_template_key text, p_before_created_at timestamptz, p_before_id uuid, p_limit integer)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.list_communication_messages(p_edition_id, p_campaign_id, p_status, p_template_key, p_before_created_at, p_before_id, p_limit) $$;

create function public.get_communication_metrics()
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.get_communication_metrics() $$;

revoke all on function
  private.create_communication_campaign(text, text, uuid, jsonb, jsonb, text),
  public.create_communication_campaign(text, text, uuid, jsonb, jsonb, text),
  private.preview_communication_campaign(uuid), public.preview_communication_campaign(uuid),
  private.schedule_communication_campaign(uuid, timestamptz), public.schedule_communication_campaign(uuid, timestamptz),
  private.send_communication_campaign(uuid, text), public.send_communication_campaign(uuid, text),
  private.cancel_communication_campaign(uuid, text), public.cancel_communication_campaign(uuid, text),
  private.list_communication_campaigns(uuid, text, timestamptz, uuid, integer),
  public.list_communication_campaigns(uuid, text, timestamptz, uuid, integer),
  private.list_communication_messages(uuid, uuid, text, text, timestamptz, uuid, integer),
  public.list_communication_messages(uuid, uuid, text, text, timestamptz, uuid, integer),
  private.get_communication_metrics(), public.get_communication_metrics()
from public, anon, authenticated, service_role;

grant execute on function
  private.create_communication_campaign(text, text, uuid, jsonb, jsonb, text),
  public.create_communication_campaign(text, text, uuid, jsonb, jsonb, text),
  private.preview_communication_campaign(uuid), public.preview_communication_campaign(uuid),
  private.schedule_communication_campaign(uuid, timestamptz), public.schedule_communication_campaign(uuid, timestamptz),
  private.send_communication_campaign(uuid, text), public.send_communication_campaign(uuid, text),
  private.cancel_communication_campaign(uuid, text), public.cancel_communication_campaign(uuid, text),
  private.list_communication_campaigns(uuid, text, timestamptz, uuid, integer),
  public.list_communication_campaigns(uuid, text, timestamptz, uuid, integer),
  private.list_communication_messages(uuid, uuid, text, text, timestamptz, uuid, integer),
  public.list_communication_messages(uuid, uuid, text, text, timestamptz, uuid, integer),
  private.get_communication_metrics(), public.get_communication_metrics()
to authenticated;

-- ---------------------------------------------------------------------------------------------
-- SYSTEM only (service_role): reconcile workers (communication-reconcile, provider-usage-reconcile).
-- ---------------------------------------------------------------------------------------------

create function public.reconcile_communications()
returns jsonb language sql security invoker set search_path = ''
as $$ select private.reconcile_communications() $$;

create function public.reconcile_provider_usage(p_provider text, p_daily_limit integer, p_remaining integer)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.reconcile_provider_usage(p_provider, p_daily_limit, p_remaining) $$;

create function public.list_messages_awaiting_provider_status(p_provider text, p_limit integer)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.list_messages_awaiting_provider_status(p_provider, p_limit) $$;

revoke all on function
  private.reconcile_communications(), public.reconcile_communications(),
  private.reconcile_provider_usage(text, integer, integer), public.reconcile_provider_usage(text, integer, integer),
  private.list_messages_awaiting_provider_status(text, integer), public.list_messages_awaiting_provider_status(text, integer)
from public, anon, authenticated, service_role;

grant execute on function
  private.reconcile_communications(), public.reconcile_communications(),
  private.reconcile_provider_usage(text, integer, integer), public.reconcile_provider_usage(text, integer, integer),
  private.list_messages_awaiting_provider_status(text, integer), public.list_messages_awaiting_provider_status(text, integer)
to service_role;
