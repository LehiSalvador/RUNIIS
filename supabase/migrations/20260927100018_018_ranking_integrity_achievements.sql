create table app.ranking_period (
  ranking_period_id uuid primary key default gen_random_uuid(),
  period_type text not null check (period_type in ('WEEKLY', 'MONTHLY', 'HISTORICAL_CUT')),
  period_key text not null,
  starts_at timestamptz not null,
  ends_at timestamptz null,
  timezone text not null check (private.is_iana_timezone(timezone)),
  status text not null default 'OPEN' check (status in ('OPEN', 'CONSOLIDATING', 'CLOSED')),
  created_at timestamptz not null default now(),
  consolidating_at timestamptz null,
  closed_at timestamptz null,
  unique (period_type, period_key),
  unique (ranking_period_id, period_type),
  constraint ranking_period_window check (ends_at is null or ends_at > starts_at),
  constraint ranking_period_closed_at check (status <> 'CLOSED' or closed_at is not null)
);
alter table app.ranking_period enable row level security;

create table app.ranking_snapshot (
  ranking_snapshot_id uuid primary key default gen_random_uuid(),
  ranking_period_id uuid not null references app.ranking_period (ranking_period_id) on delete restrict,
  revision integer not null check (revision > 0),
  status text not null default 'CURRENT' check (status in ('CURRENT', 'SUPERSEDED')),
  cutoff_at timestamptz not null,
  ranking_epoch_snapshot date not null,
  ledger_watermark text not null,
  eligibility_rule_version integer not null check (eligibility_rule_version > 0),
  generated_at timestamptz not null default now(),
  generated_by text not null,
  superseded_at timestamptz null,
  unique (ranking_period_id, revision),
  unique (ranking_snapshot_id, ranking_period_id),
  constraint ranking_snapshot_superseded check ((status = 'SUPERSEDED') = (superseded_at is not null))
);
alter table app.ranking_snapshot enable row level security;

create unique index ranking_snapshot_current_uidx on app.ranking_snapshot (ranking_period_id) where status = 'CURRENT';

create trigger append_only before update on app.ranking_snapshot
  for each row execute function private.enforce_append_only('status', 'superseded_at');
create trigger reject_delete before delete on app.ranking_snapshot
  for each row execute function private.reject_mutation();
create trigger reject_truncate before truncate on app.ranking_snapshot
  for each statement execute function private.reject_mutation();

create table app.ranking_snapshot_entry (
  ranking_snapshot_entry_id uuid primary key default gen_random_uuid(),
  ranking_snapshot_id uuid not null references app.ranking_snapshot (ranking_snapshot_id) on delete restrict,
  runner_profile_id uuid not null references app.runner_profile (runner_profile_id) on delete restrict,
  rank_position integer not null check (rank_position > 0),
  credited_distance_m bigint not null check (credited_distance_m >= 0),
  credit_count integer not null check (credit_count >= 0),
  display_name_snapshot text not null,
  avatar_asset_snapshot_id uuid null,
  eligibility_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  unique (ranking_snapshot_id, runner_profile_id)
);
alter table app.ranking_snapshot_entry enable row level security;

create trigger append_only before update or delete on app.ranking_snapshot_entry
  for each row execute function private.reject_mutation();
create trigger append_only_truncate before truncate on app.ranking_snapshot_entry
  for each statement execute function private.reject_mutation();

-- Rebuildable projection (Master §104); never an official result.
create table app.ranking_projection_entry (
  ranking_projection_entry_id uuid primary key default gen_random_uuid(),
  projection_type text not null check (projection_type in ('WEEKLY', 'MONTHLY', 'HISTORICAL_LIVE')),
  ranking_period_id uuid null,
  runner_profile_id uuid not null references app.runner_profile (runner_profile_id) on delete restrict,
  credited_distance_m bigint not null check (credited_distance_m >= 0),
  credit_count integer not null check (credit_count >= 0),
  rank_position integer not null check (rank_position > 0),
  last_recomputed_at timestamptz not null default now(),
  ledger_watermark text not null,
  constraint ranking_projection_entry_period check ((projection_type = 'HISTORICAL_LIVE') = (ranking_period_id is null)),
  -- WEEKLY/MONTHLY projections must point at a period of the same type.
  constraint ranking_projection_entry_period_fk foreign key (ranking_period_id, projection_type)
    references app.ranking_period (ranking_period_id, period_type) on delete restrict
);
alter table app.ranking_projection_entry enable row level security;

create unique index ranking_projection_entry_uidx on app.ranking_projection_entry
  (projection_type, ranking_period_id, runner_profile_id) nulls not distinct;

create table app.achievement_definition (
  achievement_definition_id uuid primary key default gen_random_uuid(),
  key text not null unique,
  family text not null check (family in ('MONTHLY_PODIUM', 'HISTORICAL_PODIUM_CUT')),
  place integer null check (place between 1 and 3),
  name text not null,
  active boolean not null default true
);
alter table app.achievement_definition enable row level security;

create table app.achievement_grant (
  achievement_grant_id uuid primary key default gen_random_uuid(),
  achievement_definition_id uuid not null
    references app.achievement_definition (achievement_definition_id) on delete restrict,
  runner_profile_id uuid not null references app.runner_profile (runner_profile_id) on delete restrict,
  ranking_period_id uuid null references app.ranking_period (ranking_period_id) on delete restrict,
  ranking_snapshot_id uuid not null references app.ranking_snapshot (ranking_snapshot_id) on delete restrict,
  historical_cutoff_date date null,
  place integer not null check (place > 0),
  grant_key text not null unique,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'REVOKED')),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz null,
  revoke_reason text null,
  created_at timestamptz not null default now(),
  constraint achievement_grant_snapshot_period_fk foreign key (ranking_snapshot_id, ranking_period_id)
    references app.ranking_snapshot (ranking_snapshot_id, ranking_period_id) on delete restrict,
  constraint achievement_grant_revoked check ((status = 'REVOKED') = (revoked_at is not null))
);
alter table app.achievement_grant enable row level security;

create trigger append_only before update on app.achievement_grant
  for each row execute function private.enforce_append_only('status', 'revoked_at', 'revoke_reason');
create trigger reject_delete before delete on app.achievement_grant
  for each row execute function private.reject_mutation();
create trigger reject_truncate before truncate on app.achievement_grant
  for each statement execute function private.reject_mutation();

create table app.community_integrity_case (
  community_integrity_case_id uuid primary key default gen_random_uuid(),
  case_type text not null check (case_type in (
    'DUPLICATE_DISTANCE_CREDIT', 'CREDIT_WITHOUT_FINAL_ATTENDANCE', 'CREDIT_WITHOUT_VALID_CLOSURE',
    'DISTANCE_MISMATCH', 'MULTIPLE_CREDITS_SAME_EDITION', 'INVALID_SPORT_DATE',
    'RANKING_PROJECTION_MISMATCH', 'ACHIEVEMENT_BASIS_INVALID', 'UNAUTHORIZED_MANUAL_CORRECTION')),
  runner_profile_id uuid null references app.runner_profile (runner_profile_id) on delete restrict,
  edition_id uuid null references app.edition (edition_id) on delete restrict,
  registration_id uuid null references app.registration (registration_id) on delete restrict,
  distance_credit_id uuid null references app.distance_credit (distance_credit_id) on delete restrict,
  ranking_period_id uuid null references app.ranking_period (ranking_period_id) on delete restrict,
  status text not null,
  severity text not null,
  blocking_level text not null,
  detected_at timestamptz not null default now(),
  resolved_at timestamptz null,
  resolution text null,
  audit_correlation_id uuid null,
  metadata jsonb not null default '{}' check (jsonb_typeof(metadata) = 'object')
);
alter table app.community_integrity_case enable row level security;
