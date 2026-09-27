create table app.guardian_event_verification (
  guardian_event_verification_id uuid primary key default gen_random_uuid(),
  registration_id uuid not null unique references app.registration (registration_id) on delete restrict,
  guardian_assignment_id uuid not null references app.guardian_assignment (guardian_assignment_id) on delete restrict,
  status text not null default 'PENDING' check (status in ('PENDING', 'VERIFIED', 'REJECTED')),
  verification_method text null,
  verified_by_staff_id uuid null references app.staff_member (staff_member_id) on delete restrict,
  verified_at timestamptz null,
  notes text null,
  created_at timestamptz not null default now(),
  constraint guardian_event_verification_verified
    check (status <> 'VERIFIED' or (verified_by_staff_id is not null and verified_at is not null))
);
alter table app.guardian_event_verification enable row level security;

create function private.check_guardian_verification_match()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from app.registration r
    join app.guardian_assignment ga on ga.guardian_assignment_id = new.guardian_assignment_id
    where r.registration_id = new.registration_id
      and (ga.minor_runner_profile_id = r.runner_profile_id or ga.minor_guest_participant_id = r.guest_participant_id)) then
    raise exception using errcode = 'foreign_key_violation',
      message = 'guardian assignment minor must be the registration participant';
  end if;
  return null;
end;
$$;

create constraint trigger check_participant after insert or update of registration_id, guardian_assignment_id
  on app.guardian_event_verification
  for each row execute function private.check_guardian_verification_match();
create trigger reject_delete before delete on app.guardian_event_verification
  for each row execute function private.reject_mutation();

create table app.attendance_checkin (
  attendance_checkin_id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references app.edition (edition_id) on delete restrict,
  registration_id uuid not null,
  participant_pass_credential_id uuid null
    references app.participant_pass_credential (participant_pass_credential_id) on delete restrict,
  status text not null default 'VERIFIED_PRESENT' check (status in ('VERIFIED_PRESENT', 'REVERSED')),
  verification_method text not null,
  checked_in_at timestamptz not null default now(),
  checked_in_by_staff_id uuid not null references app.staff_member (staff_member_id) on delete restrict,
  station_key text null,
  reversed_at timestamptz null,
  reversed_by_staff_id uuid null references app.staff_member (staff_member_id) on delete restrict,
  reversal_reason text null,
  created_at timestamptz not null default now(),
  unique (attendance_checkin_id, registration_id),
  constraint attendance_checkin_registration_fk foreign key (registration_id, edition_id)
    references app.registration (registration_id, edition_id) on delete restrict,
  constraint attendance_checkin_reversed
    check (status <> 'REVERSED' or (reversed_at is not null and reversed_by_staff_id is not null))
);
alter table app.attendance_checkin enable row level security;

create unique index attendance_checkin_present_uidx on app.attendance_checkin (registration_id)
  where status = 'VERIFIED_PRESENT';

create trigger append_only before update on app.attendance_checkin
  for each row execute function private.enforce_append_only('status', 'reversed_at', 'reversed_by_staff_id', 'reversal_reason');
create trigger reject_delete before delete on app.attendance_checkin
  for each row execute function private.reject_mutation();
create trigger reject_truncate before truncate on app.attendance_checkin
  for each statement execute function private.reject_mutation();

create table app.attendance_resolution (
  attendance_resolution_id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references app.edition (edition_id) on delete restrict,
  registration_id uuid not null,
  revision integer not null check (revision > 0),
  status text not null check (status in ('PENDING', 'PRESENT', 'NO_SHOW', 'EXCLUDED')),
  source text not null check (source in ('INITIAL', 'CHECKIN', 'MANUAL', 'CORRECTION')),
  checkin_id uuid null,
  reason text null,
  evidence_metadata jsonb not null default '{}' check (jsonb_typeof(evidence_metadata) = 'object'),
  resolved_by_staff_id uuid null references app.staff_member (staff_member_id) on delete restrict,
  resolved_at timestamptz not null default now(),
  superseded_at timestamptz null,
  unique (registration_id, revision),
  unique (attendance_resolution_id, registration_id),
  constraint attendance_resolution_registration_fk foreign key (registration_id, edition_id)
    references app.registration (registration_id, edition_id) on delete restrict,
  constraint attendance_resolution_checkin_fk foreign key (checkin_id, registration_id)
    references app.attendance_checkin (attendance_checkin_id, registration_id) on delete restrict,
  constraint attendance_resolution_checkin_source check (source <> 'CHECKIN' or checkin_id is not null),
  -- Manual PRESENT requires an accountable actor and a reason (no scan is not NO_SHOW, nor PRESENT).
  constraint attendance_resolution_manual_present
    check (status <> 'PRESENT' or source not in ('MANUAL', 'CORRECTION')
           or (resolved_by_staff_id is not null and reason is not null))
);
alter table app.attendance_resolution enable row level security;

create unique index attendance_resolution_current_uidx on app.attendance_resolution (registration_id)
  where superseded_at is null;

create trigger append_only before update on app.attendance_resolution
  for each row execute function private.enforce_append_only('superseded_at');
create trigger reject_delete before delete on app.attendance_resolution
  for each row execute function private.reject_mutation();
create trigger reject_truncate before truncate on app.attendance_resolution
  for each statement execute function private.reject_mutation();

create table app.sporting_eligibility_resolution (
  sporting_eligibility_resolution_id uuid primary key default gen_random_uuid(),
  registration_id uuid not null references app.registration (registration_id) on delete restrict,
  revision integer not null check (revision > 0),
  status text not null check (status in ('ELIGIBLE', 'DISQUALIFIED', 'EXCLUDED', 'PENDING_REVIEW')),
  distance_credit_disposition text not null check (distance_credit_disposition in ('ALLOW', 'DENY', 'PENDING')),
  reason_code text null,
  reason text null,
  resolved_by_staff_id uuid null references app.staff_member (staff_member_id) on delete restrict,
  resolved_at timestamptz not null default now(),
  superseded_at timestamptz null,
  unique (registration_id, revision),
  unique (sporting_eligibility_resolution_id, registration_id)
);
alter table app.sporting_eligibility_resolution enable row level security;

create unique index sporting_eligibility_resolution_current_uidx on app.sporting_eligibility_resolution (registration_id)
  where superseded_at is null;

create trigger append_only before update on app.sporting_eligibility_resolution
  for each row execute function private.enforce_append_only('superseded_at');
create trigger reject_delete before delete on app.sporting_eligibility_resolution
  for each row execute function private.reject_mutation();
create trigger reject_truncate before truncate on app.sporting_eligibility_resolution
  for each statement execute function private.reject_mutation();

create table app.attendance_finalization (
  attendance_finalization_id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references app.edition (edition_id) on delete restrict,
  revision integer not null check (revision > 0),
  status text not null default 'FINALIZED' check (status in ('FINALIZED', 'SUPERSEDED')),
  expected_count integer not null check (expected_count >= 0),
  present_count integer not null check (present_count >= 0),
  no_show_count integer not null check (no_show_count >= 0),
  excluded_count integer not null check (excluded_count >= 0),
  finalized_by_staff_id uuid not null references app.staff_member (staff_member_id) on delete restrict,
  finalized_at timestamptz not null default now(),
  reopened_at timestamptz null,
  reopened_by_staff_id uuid null references app.staff_member (staff_member_id) on delete restrict,
  reopen_reason text null,
  superseded_at timestamptz null,
  created_at timestamptz not null default now(),
  unique (edition_id, revision),
  unique (attendance_finalization_id, edition_id),
  constraint attendance_finalization_superseded check ((status = 'SUPERSEDED') = (superseded_at is not null)),
  -- Reopening retires the current revision (Master §98); it never coexists with a current one.
  constraint attendance_finalization_reopen
    check (reopened_at is null or (status = 'SUPERSEDED' and reopen_reason is not null))
);
alter table app.attendance_finalization enable row level security;

create unique index attendance_finalization_current_uidx on app.attendance_finalization (edition_id)
  where superseded_at is null and status = 'FINALIZED';

create trigger append_only before update on app.attendance_finalization
  for each row execute function private.enforce_append_only(
    'status', 'superseded_at', 'reopened_at', 'reopened_by_staff_id', 'reopen_reason');
create trigger reject_delete before delete on app.attendance_finalization
  for each row execute function private.reject_mutation();
create trigger reject_truncate before truncate on app.attendance_finalization
  for each statement execute function private.reject_mutation();
