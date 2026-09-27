-- current_credential_id FK is added below once app.participant_pass_credential exists.
create table app.participant_pass (
  participant_pass_id uuid primary key default gen_random_uuid(),
  registration_id uuid not null unique references app.registration (registration_id) on delete restrict,
  public_code text not null unique,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'CANCELED', 'REVOKED')),
  current_credential_id uuid null,
  issued_at timestamptz not null default now(),
  canceled_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint participant_pass_canceled_at check (status <> 'CANCELED' or canceled_at is not null)
);
alter table app.participant_pass enable row level security;

create trigger touch_updated_at before update on app.participant_pass
  for each row execute function private.touch_updated_at();
create trigger freeze_registration before update of registration_id on app.participant_pass
  for each row when (old.registration_id is distinct from new.registration_id)
  execute function private.reject_mutation('a pass belongs to one registration for life');
create trigger reject_delete before delete on app.participant_pass
  for each row execute function private.reject_mutation();
create trigger reject_truncate before truncate on app.participant_pass
  for each statement execute function private.reject_mutation();

-- Plaintext tokens are never stored: sha256 hex for lookup, AES-GCM iv||tag||ct for re-rendering.
create table app.participant_pass_credential (
  participant_pass_credential_id uuid primary key default gen_random_uuid(),
  participant_pass_id uuid not null references app.participant_pass (participant_pass_id) on delete restrict,
  version integer not null check (version > 0),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  token_ciphertext bytea not null check (octet_length(token_ciphertext) > 28),
  encryption_key_version integer not null check (encryption_key_version > 0),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'REPLACED', 'REVOKED')),
  issued_at timestamptz not null default now(),
  replaced_at timestamptz null,
  revoked_at timestamptz null,
  created_at timestamptz not null default now(),
  unique (participant_pass_id, version),
  unique (participant_pass_id, participant_pass_credential_id),
  constraint participant_pass_credential_replaced_at check (status <> 'REPLACED' or replaced_at is not null),
  constraint participant_pass_credential_revoked_at check (status <> 'REVOKED' or revoked_at is not null)
);
alter table app.participant_pass_credential enable row level security;

create unique index participant_pass_credential_active_uidx on app.participant_pass_credential (participant_pass_id)
  where status = 'ACTIVE';

create trigger append_only before update on app.participant_pass_credential
  for each row execute function private.enforce_append_only('status', 'replaced_at', 'revoked_at');
create trigger reject_delete before delete on app.participant_pass_credential
  for each row execute function private.reject_mutation();
create trigger reject_truncate before truncate on app.participant_pass_credential
  for each statement execute function private.reject_mutation();

alter table app.participant_pass
  add constraint participant_pass_current_credential_fk foreign key (participant_pass_id, current_credential_id)
  references app.participant_pass_credential (participant_pass_id, participant_pass_credential_id) on delete restrict;

-- Scans are evidence of attempts, including invalid ones, so references stay loose (nullable).
create table app.participant_pass_scan (
  participant_pass_scan_id uuid primary key default gen_random_uuid(),
  participant_pass_id uuid null references app.participant_pass (participant_pass_id) on delete restrict,
  participant_pass_credential_id uuid null
    references app.participant_pass_credential (participant_pass_credential_id) on delete restrict,
  edition_id uuid null references app.edition (edition_id) on delete restrict,
  operation_type text not null check (operation_type in ('EVENT_CHECKIN', 'KIT_PICKUP', 'MANUAL_VERIFY')),
  outcome text not null check (outcome in (
    'VALID', 'ALREADY_CHECKED_IN', 'REVOKED_CREDENTIAL', 'REPLACED_CREDENTIAL', 'WRONG_EVENT',
    'REGISTRATION_NOT_CONFIRMED', 'GUARDIAN_VERIFICATION_REQUIRED', 'UNKNOWN_PASS',
    'CANCELED_REGISTRATION', 'NOT_YET_ALLOWED', 'OTHER_REVIEW')),
  staff_member_id uuid not null references app.staff_member (staff_member_id) on delete restrict,
  station_key text null,
  scanned_at timestamptz not null default now(),
  metadata jsonb not null default '{}' check (jsonb_typeof(metadata) = 'object')
);
alter table app.participant_pass_scan enable row level security;

create trigger append_only before update or delete on app.participant_pass_scan
  for each row execute function private.reject_mutation();
create trigger append_only_truncate before truncate on app.participant_pass_scan
  for each statement execute function private.reject_mutation();
