create table app.administrative_closure (
  administrative_closure_id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references app.edition (edition_id) on delete restrict,
  revision integer not null check (revision > 0),
  attendance_finalization_id uuid not null,
  status text not null default 'CLOSED' check (status in ('CLOSED', 'SUPERSEDED')),
  closed_by_staff_id uuid not null references app.staff_member (staff_member_id) on delete restrict,
  closed_at timestamptz not null default now(),
  reopened_at timestamptz null,
  reopened_by_staff_id uuid null references app.staff_member (staff_member_id) on delete restrict,
  reopen_reason text null,
  superseded_at timestamptz null,
  created_at timestamptz not null default now(),
  unique (edition_id, revision),
  unique (administrative_closure_id, edition_id),
  constraint administrative_closure_finalization_fk foreign key (attendance_finalization_id, edition_id)
    references app.attendance_finalization (attendance_finalization_id, edition_id) on delete restrict,
  constraint administrative_closure_superseded check ((status = 'SUPERSEDED') = (superseded_at is not null)),
  -- Reopening retires the current revision (Master §98); it never coexists with a current one.
  constraint administrative_closure_reopen
    check (reopened_at is null or (status = 'SUPERSEDED' and reopen_reason is not null))
);
alter table app.administrative_closure enable row level security;

create unique index administrative_closure_current_uidx on app.administrative_closure (edition_id)
  where superseded_at is null and status = 'CLOSED';

create trigger append_only before update on app.administrative_closure
  for each row execute function private.enforce_append_only(
    'status', 'superseded_at', 'reopened_at', 'reopened_by_staff_id', 'reopen_reason');
create trigger reject_delete before delete on app.administrative_closure
  for each row execute function private.reject_mutation();
create trigger reject_truncate before truncate on app.administrative_closure
  for each statement execute function private.reject_mutation();

-- Composite FKs pin every basis row to the same registration/Edition. The registration FK includes
-- runner_profile_id, so only a PROFILE registration of that runner can hold a credit (Guest never).
create table app.distance_credit (
  distance_credit_id uuid primary key default gen_random_uuid(),
  runner_profile_id uuid not null references app.runner_profile (runner_profile_id) on delete restrict,
  registration_id uuid not null,
  edition_id uuid not null references app.edition (edition_id) on delete restrict,
  modality_id uuid not null,
  attendance_resolution_id uuid not null,
  attendance_finalization_id uuid not null,
  administrative_closure_id uuid not null,
  sporting_eligibility_resolution_id uuid not null,
  official_distance_snapshot_m integer not null check (official_distance_snapshot_m > 0),
  credited_distance_m integer not null check (credited_distance_m >= 0),
  sport_date date not null,
  sport_timezone text not null check (btrim(sport_timezone) <> ''),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'REVERSED')),
  source text not null default 'EVENT_ATTENDANCE' check (source in ('EVENT_ATTENDANCE')),
  created_at timestamptz not null default now(),
  reversed_at timestamptz null,
  reversed_by_staff_id uuid null references app.staff_member (staff_member_id) on delete restrict,
  reversal_reason text null,
  supersedes_distance_credit_id uuid null references app.distance_credit (distance_credit_id) on delete restrict,
  constraint distance_credit_registration_fk foreign key (registration_id, edition_id, runner_profile_id)
    references app.registration (registration_id, edition_id, runner_profile_id) on delete restrict,
  constraint distance_credit_modality_fk foreign key (edition_id, modality_id)
    references app.modality (edition_id, modality_id) on delete restrict,
  constraint distance_credit_attendance_resolution_fk foreign key (attendance_resolution_id, registration_id)
    references app.attendance_resolution (attendance_resolution_id, registration_id) on delete restrict,
  constraint distance_credit_attendance_finalization_fk foreign key (attendance_finalization_id, edition_id)
    references app.attendance_finalization (attendance_finalization_id, edition_id) on delete restrict,
  constraint distance_credit_administrative_closure_fk foreign key (administrative_closure_id, edition_id)
    references app.administrative_closure (administrative_closure_id, edition_id) on delete restrict,
  constraint distance_credit_sporting_eligibility_fk foreign key (sporting_eligibility_resolution_id, registration_id)
    references app.sporting_eligibility_resolution (sporting_eligibility_resolution_id, registration_id) on delete restrict,
  constraint distance_credit_reversed check ((status = 'REVERSED') = (reversed_at is not null)),
  constraint distance_credit_not_self_superseding check (supersedes_distance_credit_id <> distance_credit_id)
);
alter table app.distance_credit enable row level security;

create unique index distance_credit_active_uidx on app.distance_credit (registration_id) where status = 'ACTIVE';

create trigger append_only before update on app.distance_credit
  for each row execute function private.enforce_append_only('status', 'reversed_at', 'reversed_by_staff_id', 'reversal_reason');
create trigger reject_delete before delete on app.distance_credit
  for each row execute function private.reject_mutation();
create trigger reject_truncate before truncate on app.distance_credit
  for each statement execute function private.reject_mutation();
