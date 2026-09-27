create table app.legal_document (
  legal_document_id uuid primary key default gen_random_uuid(),
  document_key text not null unique,
  document_type text not null
    check (document_type in ('TERMS_OF_SERVICE', 'PRIVACY_NOTICE', 'SPORT_WAIVER', 'MINOR_TERMS', 'EVENT_RULES')),
  status text not null,
  created_at timestamptz not null default now()
);
alter table app.legal_document enable row level security;

create table app.legal_document_version (
  legal_document_version_id uuid primary key default gen_random_uuid(),
  legal_document_id uuid not null references app.legal_document (legal_document_id) on delete restrict,
  version integer not null check (version > 0),
  content_markdown text null,
  public_asset_key text null,
  status text not null,
  published_at timestamptz null,
  created_at timestamptz not null default now(),
  unique (legal_document_id, version)
);
alter table app.legal_document_version enable row level security;

-- edition_id and registration_request_id FKs are added in 008 and 012.
create table app.legal_acceptance (
  legal_acceptance_id uuid primary key default gen_random_uuid(),
  runner_profile_id uuid not null references app.runner_profile (runner_profile_id) on delete restrict,
  legal_document_version_id uuid not null
    references app.legal_document_version (legal_document_version_id) on delete restrict,
  edition_id uuid null,
  registration_request_id uuid null,
  participant_runner_profile_id uuid null references app.runner_profile (runner_profile_id) on delete restrict,
  guardian_assignment_id uuid null references app.guardian_assignment (guardian_assignment_id) on delete restrict,
  accepted_at timestamptz not null default now(),
  acceptance_context jsonb not null default '{}' check (jsonb_typeof(acceptance_context) = 'object'),
  constraint legal_acceptance_request_has_edition check (registration_request_id is null or edition_id is not null)
);
alter table app.legal_acceptance enable row level security;

create trigger append_only before update or delete on app.legal_acceptance
  for each row execute function private.reject_mutation();
create trigger append_only_truncate before truncate on app.legal_acceptance
  for each statement execute function private.reject_mutation();

create table app.platform_settings (
  settings_id smallint primary key check (settings_id = 1),
  timezone text not null default 'America/Monterrey' check (private.is_iana_timezone(timezone)),
  -- Nullable until PEND-OPS-001 supplies the number (ADR-001 decision 14).
  default_whatsapp_phone_e164 text null check (default_whatsapp_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  registration_hold_minutes integer not null default 1440 check (registration_hold_minutes > 0),
  registration_close_offset_minutes integer not null default 2880 check (registration_close_offset_minutes >= 0),
  email_otp_expiry_seconds integer not null default 600 check (email_otp_expiry_seconds > 0),
  availability_low_threshold_percent numeric null
    check (availability_low_threshold_percent > 0 and availability_low_threshold_percent < 100),
  updated_at timestamptz not null default now(),
  updated_by_staff_id uuid null references app.staff_member (staff_member_id) on delete restrict
);
alter table app.platform_settings enable row level security;

create trigger touch_updated_at before update on app.platform_settings
  for each row execute function private.touch_updated_at();

create table app.competition_settings (
  settings_id smallint primary key check (settings_id = 1),
  timezone text not null default 'America/Monterrey' check (private.is_iana_timezone(timezone)),
  ranking_epoch date null,
  ranking_epoch_frozen_at timestamptz null,
  updated_at timestamptz not null default now(),
  updated_by_staff_id uuid null references app.staff_member (staff_member_id) on delete restrict,
  constraint competition_settings_frozen_epoch check (ranking_epoch_frozen_at is null or ranking_epoch is not null)
);
alter table app.competition_settings enable row level security;

create trigger touch_updated_at before update on app.competition_settings
  for each row execute function private.touch_updated_at();
