create table app.communication_recipient (
  communication_recipient_id uuid primary key default gen_random_uuid(),
  recipient_type text not null check (recipient_type in ('RUNNER', 'GUEST', 'ANONYMOUS')),
  runner_profile_id uuid null unique references app.runner_profile (runner_profile_id) on delete restrict,
  guest_participant_id uuid null unique references app.guest_participant (guest_participant_id) on delete restrict,
  anonymous_key uuid null unique,
  created_at timestamptz not null default now(),
  constraint communication_recipient_one_target check (
    case recipient_type
      when 'RUNNER' then runner_profile_id is not null and guest_participant_id is null and anonymous_key is null
      when 'GUEST' then guest_participant_id is not null and runner_profile_id is null and anonymous_key is null
      else anonymous_key is not null and runner_profile_id is null and guest_participant_id is null
    end)
);
alter table app.communication_recipient enable row level security;

-- An email change creates a new contact point; old ones are RETIRED so consent evidence stays traceable.
create table app.communication_contact_point (
  communication_contact_point_id uuid primary key default gen_random_uuid(),
  communication_recipient_id uuid not null
    references app.communication_recipient (communication_recipient_id) on delete restrict,
  channel text not null check (channel in ('EMAIL')),
  value_normalized text not null check (value_normalized = lower(btrim(value_normalized)) and value_normalized <> ''),
  verification_status text not null default 'UNVERIFIED' check (verification_status in ('UNVERIFIED', 'VERIFIED')),
  verified_at timestamptz null,
  is_primary boolean not null,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'RETIRED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (communication_contact_point_id, communication_recipient_id),
  constraint communication_contact_point_verified_at check (verification_status <> 'VERIFIED' or verified_at is not null)
);
alter table app.communication_contact_point enable row level security;

create unique index communication_contact_point_active_value_uidx on app.communication_contact_point
  (communication_recipient_id, channel, value_normalized) where status = 'ACTIVE';
create unique index communication_contact_point_primary_uidx on app.communication_contact_point
  (communication_recipient_id, channel) where status = 'ACTIVE' and is_primary;

create trigger touch_updated_at before update on app.communication_contact_point
  for each row execute function private.touch_updated_at();
create trigger freeze_identity before update of communication_recipient_id, channel, value_normalized
  on app.communication_contact_point for each row
  when (row(old.communication_recipient_id, old.channel, old.value_normalized)
        is distinct from row(new.communication_recipient_id, new.channel, new.value_normalized))
  execute function private.reject_mutation('create a new contact point instead of rewriting an address');

create table app.communication_consent (
  communication_consent_id uuid primary key default gen_random_uuid(),
  communication_recipient_id uuid not null
    references app.communication_recipient (communication_recipient_id) on delete restrict,
  purpose text not null check (purpose in ('GENERAL_MARKETING', 'EVENT_REMINDER', 'OTHER_OPTIONAL')),
  action text not null check (action in ('GRANTED', 'WITHDRAWN')),
  legal_document_version_id uuid null
    references app.legal_document_version (legal_document_version_id) on delete restrict,
  source text not null,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}' check (jsonb_typeof(metadata) = 'object')
);
alter table app.communication_consent enable row level security;

create trigger append_only before update or delete on app.communication_consent
  for each row execute function private.reject_mutation();
create trigger append_only_truncate before truncate on app.communication_consent
  for each statement execute function private.reject_mutation();

create table app.communication_preference (
  communication_recipient_id uuid primary key
    references app.communication_recipient (communication_recipient_id) on delete restrict,
  marketing_allowed boolean not null,
  updated_at timestamptz not null default now()
);
alter table app.communication_preference enable row level security;

create trigger touch_updated_at before update on app.communication_preference
  for each row execute function private.touch_updated_at();

create table app.edition_interest (
  runner_profile_id uuid not null references app.runner_profile (runner_profile_id) on delete restrict,
  edition_id uuid not null references app.edition (edition_id) on delete restrict,
  interest_type text not null default 'FAVORITE' check (interest_type in ('FAVORITE')),
  created_at timestamptz not null default now(),
  primary key (runner_profile_id, edition_id, interest_type)
);
alter table app.edition_interest enable row level security;

create table app.event_reminder_subscription (
  event_reminder_subscription_id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references app.edition (edition_id) on delete restrict,
  communication_recipient_id uuid not null
    references app.communication_recipient (communication_recipient_id) on delete restrict,
  reminder_type text not null,
  status text not null default 'PENDING_CONFIRMATION'
    check (status in ('PENDING_CONFIRMATION', 'ACTIVE', 'CANCELED', 'COMPLETED')),
  created_at timestamptz not null default now(),
  confirmed_at timestamptz null,
  canceled_at timestamptz null,
  constraint event_reminder_subscription_confirmed_at check (status <> 'ACTIVE' or confirmed_at is not null),
  constraint event_reminder_subscription_canceled_at check (status <> 'CANCELED' or canceled_at is not null)
);
alter table app.event_reminder_subscription enable row level security;

create unique index event_reminder_subscription_live_uidx on app.event_reminder_subscription
  (edition_id, communication_recipient_id, reminder_type) where status in ('PENDING_CONFIRMATION', 'ACTIVE');

create table app.communication_suppression (
  suppression_id uuid primary key default gen_random_uuid(),
  contact_point_id uuid not null
    references app.communication_contact_point (communication_contact_point_id) on delete restrict,
  reason text not null check (reason in (
    'HARD_BOUNCE', 'SPAM_COMPLAINT', 'INVALID_ADDRESS', 'GLOBAL_OPTIONAL_OPTOUT', 'LEGAL_RESTRICTION',
    'PROVIDER_SUPPRESSION', 'ADMIN_SAFETY_BLOCK', 'CONTACT_RETIRED')),
  scope text not null check (scope in ('ALL_EMAIL', 'OPTIONAL_ONLY', 'MARKETING_ONLY')),
  source text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  resolved_at timestamptz null,
  resolved_by_staff_id uuid null references app.staff_member (staff_member_id) on delete restrict,
  resolution_reason text null,
  constraint communication_suppression_resolved check (active = (resolved_at is null))
);
alter table app.communication_suppression enable row level security;
