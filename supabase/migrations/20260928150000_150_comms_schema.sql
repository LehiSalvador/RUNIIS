-- T35 communications: value sets, dispatch/lease columns, action tokens and quota policy on top of
-- the 020/021 foundation (Master §125-141, §147-148; SEC-037/042/080/082/084).

alter table app.event_reminder_subscription
  add constraint event_reminder_subscription_type check (reminder_type in ('REGISTRATION_OPENED'));

alter table app.communication_automation_rule
  add constraint communication_automation_rule_recipient_policy check (recipient_policy in (
    'AUTH_EMAIL', 'ANONYMOUS_SUBSCRIBER', 'CAMPAIGN_AUDIENCE', 'REMINDER_SUBSCRIBERS', 'PARTICIPANT_OR_GUEST_BUYER',
    'REQUEST_BUYER', 'GUARDIAN', 'CONFIRMED_PARTICIPANTS', 'CONFIRMED_AND_REMINDER_SUBSCRIBERS',
    'ADULT_MARKETING_OPT_IN')),
  add constraint communication_automation_rule_consent_policy check (consent_policy in (
    'NONE_REQUIRED', 'EMAIL_VERIFICATION', 'EVENT_REMINDER', 'GENERAL_MARKETING'));

alter table app.communication_campaign
  add column template_variables jsonb not null default '{}' check (jsonb_typeof(template_variables) = 'object'),
  add constraint communication_campaign_type check (campaign_type in ('MARKETING', 'OPERATIONAL')),
  add constraint communication_campaign_purpose check (
    (campaign_type = 'MARKETING' and purpose = 'GENERAL_MARKETING')
    or (campaign_type = 'OPERATIONAL' and purpose = 'OPERATIONAL')),
  add constraint communication_campaign_operational_edition check (campaign_type <> 'OPERATIONAL' or edition_id is not null),
  add constraint communication_campaign_started_at check (status not in ('SENDING', 'COMPLETED') or started_at is not null),
  add constraint communication_campaign_completed_at check (status not in ('COMPLETED', 'FAILED') or completed_at is not null);

alter table app.communication_campaign_recipient
  add constraint communication_campaign_recipient_snapshot_status check (snapshot_status in ('CANDIDATE', 'EXCLUDED')),
  add constraint communication_campaign_recipient_exclusion check ((snapshot_status = 'EXCLUDED') = (exclusion_reason is not null));

-- Lease and provider correlation for the message dispatcher (same claim model as the outbox).
alter table app.communication_message
  add column automation_rule_key text null,
  add column attempt_count integer not null default 0 check (attempt_count >= 0),
  add column claimed_by text null,
  add column claim_expires_at timestamptz null,
  add column provider text null,
  add column provider_message_id text null,
  add column provider_status_at timestamptz null,
  add column quota_usage_date date null,
  add column escalated_at timestamptz null,
  add constraint communication_message_sending_claim
    check (status <> 'SENDING' or (claimed_by is not null and claim_expires_at is not null)),
  add constraint communication_message_sent_at
    check (status not in ('SENT', 'DELIVERED', 'BOUNCED', 'COMPLAINED') or sent_at is not null),
  -- SEC-037/A3: the snapshot carries ids and display values only, never QR credential material.
  add constraint communication_message_no_credential check (render_context_snapshot::text !~ 'RN1\.');

create index communication_message_claim_idx on app.communication_message (priority, scheduled_for)
  where status in ('QUEUED', 'WAITING_FOR_QUOTA');
create index communication_message_lease_idx on app.communication_message (claim_expires_at) where status = 'SENDING';
create index communication_message_edition_status_idx on app.communication_message (edition_id, status)
  where edition_id is not null;
create index communication_message_awaiting_provider_idx on app.communication_message (sent_at) where status = 'SENT';

alter table app.communication_delivery_attempt
  add constraint communication_delivery_attempt_status check (status in (
    'PENDING', 'ACCEPTED', 'RETRYABLE_FAILURE', 'PERMANENT_FAILURE', 'BLOCKED_BY_POLICY', 'ABANDONED')),
  add constraint communication_delivery_attempt_provider check (provider in ('brevo', 'capture')),
  add constraint communication_delivery_attempt_resolved check ((status = 'PENDING') = (resolved_at is null));
create unique index communication_delivery_attempt_provider_message_uidx
  on app.communication_delivery_attempt (provider, provider_message_id) where provider_message_id is not null;

alter table infra.communication_provider_event
  add constraint communication_provider_event_status check (processing_status in (
    'RECEIVED', 'PROCESSED', 'IGNORED', 'UNMATCHED', 'UNAUTHENTICATED')),
  add constraint communication_provider_event_payload check (jsonb_typeof(payload_safe) = 'object'),
  -- Unauthenticated deliveries are evidence only and never change state (SEC-080).
  add constraint communication_provider_event_unauthenticated
    check (authenticated or processing_status = 'UNAUTHENTICATED');

alter table app.communication_suppression
  add column source_message_id uuid null
    references app.communication_message (communication_message_id) on delete restrict;
create unique index communication_suppression_active_uidx
  on app.communication_suppression (contact_point_id, reason, scope) where active;

-- Single-use / scoped action links (SEC-082, SEC-084). Only sha256(token) is stored; the plaintext is
-- generated at dispatch time, embedded in the recipient's own email and never persisted.
create table private.communication_action_token (
  communication_action_token_id uuid primary key default gen_random_uuid(),
  purpose text not null check (purpose in ('REMINDER_CONFIRMATION', 'UNSUBSCRIBE_MARKETING', 'UNSUBSCRIBE_REMINDERS')),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  communication_recipient_id uuid not null
    references app.communication_recipient (communication_recipient_id) on delete restrict,
  contact_point_id uuid not null,
  event_reminder_subscription_id uuid null
    references app.event_reminder_subscription (event_reminder_subscription_id) on delete restrict,
  communication_message_id uuid not null
    references app.communication_message (communication_message_id) on delete restrict,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz null,
  constraint communication_action_token_contact_fk foreign key (contact_point_id, communication_recipient_id)
    references app.communication_contact_point (communication_contact_point_id, communication_recipient_id)
    on delete restrict,
  constraint communication_action_token_expiry check (expires_at > created_at),
  constraint communication_action_token_subscription
    check (purpose <> 'REMINDER_CONFIRMATION' or event_reminder_subscription_id is not null)
);
alter table private.communication_action_token enable row level security;
create index communication_action_token_subscription_idx on private.communication_action_token (event_reminder_subscription_id)
  where event_reminder_subscription_id is not null;

-- Provider quota is configuration (Master §140-141): the dispatcher never hardcodes limits.
-- critical_reserve is kept for P0/P1 (incl. Supabase Auth OTP over the same Brevo account); P3 and
-- anonymous recipients also stop at optional_stop_ratio of the daily limit (SEC-042).
create table infra.communication_provider_policy (
  provider text primary key check (provider in ('brevo', 'capture')),
  daily_limit integer not null check (daily_limit > 0),
  critical_reserve integer not null check (critical_reserve >= 0),
  optional_stop_ratio numeric(4, 3) not null check (optional_stop_ratio > 0 and optional_stop_ratio <= 1),
  alert_ratios numeric(4, 3)[] not null default '{}',
  counts_auth_otp boolean not null,
  updated_at timestamptz not null default now(),
  constraint communication_provider_policy_reserve check (critical_reserve < daily_limit)
);
alter table infra.communication_provider_policy enable row level security;

-- Brevo free tier as of 2026-09 (300/day). Verify the live plan before production; provider-usage-reconcile
-- also snapshots the limit the provider reports.
insert into infra.communication_provider_policy (provider, daily_limit, critical_reserve, optional_stop_ratio, alert_ratios, counts_auth_otp)
values ('brevo', 300, 60, 0.800, '{0.5,0.8}', true),
       ('capture', 5000, 0, 1.000, '{}', false);

-- Rate limits (ADR-001 §9, A6). SUPPLIED scopes are consumed by Next with the client IP / email; the
-- :cmd scopes are consumed inside the commands so direct PostgREST callers are bounded too.
insert into infra.rate_limit_policy (scope, max_hits, window_seconds, subject_kind, description) values
  ('reminder.anonymous.ip', 10, 3600, 'SUPPLIED', 'Anonymous reminder requests per client IP (SEC-082)'),
  ('reminder.anonymous.email', 3, 86400, 'SUPPLIED', 'Anonymous reminder requests per email (SEC-082)'),
  ('reminder.anonymous.email:cmd', 5, 86400, 'SUPPLIED', 'Anonymous reminder confirmations enqueued per email'),
  ('reminder.confirm.ip', 30, 3600, 'SUPPLIED', 'Reminder confirmation attempts per client IP'),
  ('communication.unsubscribe.ip', 60, 3600, 'SUPPLIED', 'One-click unsubscribe attempts per client IP'),
  ('webhook.email.unauthenticated.ip', 30, 3600, 'SUPPLIED', 'Unauthenticated email webhook records per IP (SEC-080)'),
  ('communication.self:cmd', 60, 600, 'ACTOR', 'Favorites, reminders and preference changes per user'),
  ('admin.mutation:cmd', 120, 60, 'ACTOR', 'Master §179 admin mutations counted inside commands')
on conflict (scope) do nothing;
