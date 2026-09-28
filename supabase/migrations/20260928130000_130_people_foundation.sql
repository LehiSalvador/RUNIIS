-- People domain (T33, Master §19-25): schema additions, configuration and shared read helpers.
-- Helpers here are definer-internal (no API grant); commands in 131-135 call them.

-- Who opened a GuardianAssignment decides who must confirm it (ADR-001 A10: ACTIVE only after the
-- other party confirms in-app). Guest-minor assignments are always opened by the guest owner.
alter table app.guardian_assignment
  add column if not exists requested_by_profile_id uuid null
    references app.runner_profile (runner_profile_id) on delete restrict;
alter table app.guardian_assignment drop constraint if exists guardian_assignment_requested_by_party;
alter table app.guardian_assignment add constraint guardian_assignment_requested_by_party check (
  requested_by_profile_id is null or minor_guest_participant_id is not null
  or requested_by_profile_id in (minor_runner_profile_id, guardian_profile_id));

-- Floor for archive_after after an explicit reactivation (Master §25 recomputation keeps it).
alter table app.guest_participant add column if not exists reactivated_at timestamptz null;

-- Same value set as the runner profile emergency relationship (024).
alter table app.guest_participant drop constraint if exists guest_participant_emergency_relationship;
alter table app.guest_participant add constraint guest_participant_emergency_relationship
  check (btrim(emergency_contact_relationship) <> '' and char_length(emergency_contact_relationship) <= 60);

-- One live Guest per owner and identity: two rows for the same person would let a buyer bypass the
-- per-participant claim/registration uniqueness, which is keyed by guest_participant_id.
create unique index if not exists guest_participant_owner_identity_live_uidx on app.guest_participant
  (owner_profile_id, private.normalize_search_text(full_name), date_of_birth)
  where status = 'ACTIVE';
create index if not exists guest_participant_archive_due_idx on app.guest_participant (archive_after)
  where status = 'ACTIVE';

-- Two-layer rate limits (A6): pre-check scopes are consumed by Next, `:cmd` scopes by the commands.
insert into infra.rate_limit_policy (scope, max_hits, window_seconds, subject_kind, description) values
  ('people.search:cmd', 60, 600, 'ACTOR', 'Master §179 people search (command success path)'),
  ('friendship.request.minute:cmd', 5, 60, 'ACTOR', 'Master §179 friend request per minute (command)'),
  ('friendship.request.day:cmd', 30, 86400, 'ACTOR', 'Master §179 friend request per day (command)'),
  ('guest.create', 20, 86400, 'ACTOR', 'Guest creation per owner per day (T33 abuse bound)'),
  ('guest.create:cmd', 20, 86400, 'ACTOR', 'Guest creation per owner per day (command)'),
  ('guardian.request', 10, 86400, 'ACTOR', 'Guardian assignment requests per day (T33 abuse bound)'),
  ('guardian.request:cmd', 10, 86400, 'ACTOR', 'Guardian assignment requests per day (command)'),
  ('admin.mutation:cmd', 120, 60, 'ACTOR', 'Master §179 admin mutations per staff (command)')
on conflict (scope) do nothing;

-- Revoking a guardian relation for a person is platform-wide, not Edition-scoped.
insert into private.staff_action (action, global_only) values ('GUARDIAN_ASSIGNMENT_MANAGE', true)
on conflict (action) do nothing;
insert into private.staff_permission (role, action) values ('ADMIN', 'GUARDIAN_ASSIGNMENT_MANAGE')
on conflict (role, action) do nothing;

-- Operational calendar date (Master: America/Monterrey).
create or replace function private.people_today()
returns date
language sql
stable
set search_path = ''
as $$
  select (pg_catalog.now() at time zone 'America/Monterrey')::date
$$;

create or replace function private.people_age_years(p_date_of_birth date, p_on date)
returns integer
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select pg_catalog.date_part('year', pg_catalog.age(p_on::timestamp, p_date_of_birth::timestamp))::integer
$$;

-- READY + ACTIVE and no active blocked identity (Master §121: banned/locked/deactivated are out of
-- friends, search, guardianship and inclusion).
create or replace function private.people_profile_available(p_runner_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from app.runner_profile rp
    where rp.runner_profile_id = p_runner_profile_id
      and rp.profile_readiness = 'READY'
      and rp.account_state = 'ACTIVE'
      and not exists (select 1 from private.blocked_identity b where b.runner_profile_id = rp.runner_profile_id and b.active))
$$;

-- Minimal public card: the only profile data other people ever receive from this module.
create or replace function private.people_public_card(p_runner_profile_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'public_profile_id', cp.public_profile_id,
    'display_name', cp.display_name,
    'avatar_object_key', a.public_object_key)
  from app.community_profile cp
  left join app.profile_image_asset a
    on a.profile_image_asset_id = cp.avatar_asset_id and a.status = 'APPROVED'
  where cp.runner_profile_id = p_runner_profile_id
$$;

-- Client-facing ids are public_profile_id; runner_profile_id stays internal. NULL when unknown.
create or replace function private.people_runner_id_for_public_profile(p_public_profile_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select cp.runner_profile_id from app.community_profile cp where cp.public_profile_id = p_public_profile_id
$$;

-- Event calendar date (sport_date) of an Edition from the events kernel; NULL while undated.
create or replace function private.people_edition_event_date(p_edition_id uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (private.effective_start(p_edition_id) ->> 'sport_date')::date
$$;

-- Effective end of an Edition: explicit effective end, else local end time, else end of the local day.
-- NULL while undated (postponed without a new date).
create or replace function private.people_edition_effective_end(p_edition_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    r.effective_end_at,
    case when r.local_date is not null and r.local_end_time is not null
      then (r.local_date + r.local_end_time) at time zone r.timezone end,
    case when r.local_date is not null
      then (r.local_date + 1)::timestamp at time zone r.timezone end)
  from app.edition_schedule_revision r
  where r.edition_id = p_edition_id and r.superseded_at is null
$$;

-- Maps the first unexpected key of a jsonb patch to a client-safe field name.
create or replace function private.people_safe_field(p_key text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_key ~ '^[a-z][a-z0-9_]{0,62}$' then p_key else 'unknown' end
$$;

revoke all on function
  private.people_today(),
  private.people_age_years(date, date),
  private.people_profile_available(uuid),
  private.people_public_card(uuid),
  private.people_runner_id_for_public_profile(uuid),
  private.people_edition_event_date(uuid),
  private.people_edition_effective_end(uuid),
  private.people_safe_field(text)
from public, anon, authenticated, service_role;
