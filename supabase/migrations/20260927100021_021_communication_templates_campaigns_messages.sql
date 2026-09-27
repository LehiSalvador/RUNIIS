create table app.communication_template (
  communication_template_id uuid primary key default gen_random_uuid(),
  template_key text not null unique,
  category text not null check (category in ('SECURITY', 'TRANSACTIONAL', 'OPERATIONAL', 'REMINDER', 'MARKETING')),
  active_version integer not null check (active_version > 0),
  created_at timestamptz not null default now()
);
alter table app.communication_template enable row level security;

create table app.communication_template_version (
  communication_template_version_id uuid primary key default gen_random_uuid(),
  template_id uuid not null references app.communication_template (communication_template_id) on delete restrict,
  version integer not null check (version > 0),
  subject_template text not null,
  html_template text not null,
  text_template text not null,
  variable_schema jsonb not null check (jsonb_typeof(variable_schema) = 'object'),
  created_at timestamptz not null default now(),
  unique (template_id, version)
);
alter table app.communication_template_version enable row level security;

-- Sent messages reference template versions as evidence; versions are never rewritten.
create trigger append_only before update or delete on app.communication_template_version
  for each row execute function private.reject_mutation();

create table app.communication_automation_rule (
  communication_automation_rule_id uuid primary key default gen_random_uuid(),
  rule_key text not null unique,
  trigger_event text not null,
  template_key text not null,
  category text not null check (category in ('SECURITY', 'TRANSACTIONAL', 'OPERATIONAL', 'REMINDER', 'MARKETING')),
  priority integer not null check (priority between 0 and 3),
  recipient_policy text not null,
  consent_policy text not null,
  scheduling_policy jsonb not null default '{}' check (jsonb_typeof(scheduling_policy) = 'object'),
  dedupe_policy jsonb not null check (jsonb_typeof(dedupe_policy) = 'object'),
  active boolean not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table app.communication_automation_rule enable row level security;

create trigger touch_updated_at before update on app.communication_automation_rule
  for each row execute function private.touch_updated_at();

create table app.communication_campaign (
  communication_campaign_id uuid primary key default gen_random_uuid(),
  campaign_type text not null,
  edition_id uuid null references app.edition (edition_id) on delete restrict,
  template_key text not null,
  status text not null default 'DRAFT'
    check (status in ('DRAFT', 'READY', 'SCHEDULED', 'SENDING', 'COMPLETED', 'CANCELED', 'FAILED')),
  purpose text not null,
  created_by_staff_id uuid not null references app.staff_member (staff_member_id) on delete restrict,
  audience_definition jsonb not null check (jsonb_typeof(audience_definition) = 'object'),
  estimated_recipient_count integer null check (estimated_recipient_count >= 0),
  scheduled_for timestamptz null,
  created_at timestamptz not null default now(),
  started_at timestamptz null,
  completed_at timestamptz null,
  canceled_at timestamptz null,
  constraint communication_campaign_scheduled_for check (status <> 'SCHEDULED' or scheduled_for is not null),
  constraint communication_campaign_canceled_at check (status <> 'CANCELED' or canceled_at is not null)
);
alter table app.communication_campaign enable row level security;

create table app.communication_campaign_recipient (
  communication_campaign_recipient_id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references app.communication_campaign (communication_campaign_id) on delete restrict,
  communication_recipient_id uuid not null
    references app.communication_recipient (communication_recipient_id) on delete restrict,
  snapshot_status text not null,
  exclusion_reason text null,
  created_at timestamptz not null default now(),
  unique (campaign_id, communication_recipient_id)
);
alter table app.communication_campaign_recipient enable row level security;

-- render_context_snapshot must never contain a QR token plaintext (enforced by the enqueueing command).
create table app.communication_message (
  communication_message_id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique,
  recipient_id uuid not null references app.communication_recipient (communication_recipient_id) on delete restrict,
  contact_point_id uuid not null,
  template_key text not null,
  template_version integer not null check (template_version > 0),
  category text not null check (category in ('SECURITY', 'TRANSACTIONAL', 'OPERATIONAL', 'REMINDER', 'MARKETING')),
  priority integer not null check (priority between 0 and 3),
  purpose text not null,
  source_type text not null,
  source_id uuid null,
  edition_id uuid null references app.edition (edition_id) on delete restrict,
  registration_id uuid null references app.registration (registration_id) on delete restrict,
  participant_pass_id uuid null references app.participant_pass (participant_pass_id) on delete restrict,
  campaign_id uuid null references app.communication_campaign (communication_campaign_id) on delete restrict,
  render_context_snapshot jsonb not null check (jsonb_typeof(render_context_snapshot) = 'object'),
  rendered_subject_snapshot text not null,
  status text not null default 'QUEUED' check (status in (
    'QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'BOUNCED', 'COMPLAINED', 'FAILED', 'CANCELED', 'WAITING_FOR_QUOTA')),
  scheduled_for timestamptz not null default now(),
  created_at timestamptz not null default now(),
  sent_at timestamptz null,
  last_error text null,
  constraint communication_message_contact_point_fk foreign key (contact_point_id, recipient_id)
    references app.communication_contact_point (communication_contact_point_id, communication_recipient_id)
    on delete restrict
);
alter table app.communication_message enable row level security;

create trigger reject_delete before delete on app.communication_message
  for each row execute function private.reject_mutation();

create table app.communication_delivery_attempt (
  communication_delivery_attempt_id uuid primary key default gen_random_uuid(),
  communication_message_id uuid not null
    references app.communication_message (communication_message_id) on delete restrict,
  provider text not null,
  provider_message_id text null,
  status text not null,
  attempt_number integer not null check (attempt_number > 0),
  attempted_at timestamptz not null default now(),
  resolved_at timestamptz null,
  error_code text null,
  error_detail_safe text null,
  unique (communication_message_id, attempt_number)
);
alter table app.communication_delivery_attempt enable row level security;

create table infra.communication_provider_event (
  communication_provider_event_id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text not null,
  provider_message_id text null,
  event_type text not null,
  received_at timestamptz not null default now(),
  authenticated boolean not null,
  payload_safe jsonb not null,
  processed_at timestamptz null,
  processing_status text not null,
  unique (provider, provider_event_id)
);
alter table infra.communication_provider_event enable row level security;

create table app.communication_provider_usage (
  usage_id uuid primary key default gen_random_uuid(),
  provider text not null,
  usage_date date not null,
  sent_total integer not null default 0 check (sent_total >= 0),
  sent_security integer not null default 0 check (sent_security >= 0),
  sent_operational integer not null default 0 check (sent_operational >= 0),
  sent_reminder integer not null default 0 check (sent_reminder >= 0),
  sent_marketing integer not null default 0 check (sent_marketing >= 0),
  daily_limit_snapshot integer null check (daily_limit_snapshot >= 0),
  monthly_limit_snapshot integer null check (monthly_limit_snapshot >= 0),
  updated_at timestamptz not null default now(),
  unique (provider, usage_date)
);
alter table app.communication_provider_usage enable row level security;

create trigger touch_updated_at before update on app.communication_provider_usage
  for each row execute function private.touch_updated_at();
