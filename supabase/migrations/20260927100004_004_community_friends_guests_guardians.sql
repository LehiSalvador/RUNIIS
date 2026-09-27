create table app.community_profile (
  runner_profile_id uuid primary key references app.runner_profile (runner_profile_id) on delete restrict,
  public_profile_id uuid not null unique default gen_random_uuid(),
  display_name text not null check (btrim(display_name) <> ''),
  avatar_asset_id uuid null,
  competition_status text not null
    check (competition_status in ('ELIGIBLE', 'MINOR_NONCOMPETITIVE', 'SUSPENDED', 'INELIGIBLE')),
  is_visible boolean not null default true,
  is_searchable boolean not null default true,
  verified_distance_projection_m bigint not null default 0 check (verified_distance_projection_m >= 0),
  verified_participation_count integer not null default 0 check (verified_participation_count >= 0),
  updated_at timestamptz not null default now()
);
alter table app.community_profile enable row level security;

create trigger touch_updated_at before update on app.community_profile
  for each row execute function private.touch_updated_at();

create function private.default_community_display_name()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.display_name is null then
    select rp.full_name into new.display_name
    from app.runner_profile rp
    where rp.runner_profile_id = new.runner_profile_id;
  end if;
  return new;
end;
$$;

create trigger default_display_name before insert on app.community_profile
  for each row execute function private.default_community_display_name();

-- display_name follows full_name only while it still equals the previous full_name;
-- a value set by an explicit staff correction command is left untouched.
create function private.sync_community_display_name()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.full_name is not null then
    update app.community_profile cp
    set display_name = new.full_name
    where cp.runner_profile_id = new.runner_profile_id
      and cp.display_name is not distinct from old.full_name;
  end if;
  return null;
end;
$$;

create trigger sync_display_name after update of full_name on app.runner_profile
  for each row when (old.full_name is distinct from new.full_name)
  execute function private.sync_community_display_name();

create table app.friendship (
  friendship_id uuid primary key default gen_random_uuid(),
  requester_profile_id uuid not null references app.runner_profile (runner_profile_id) on delete restrict,
  addressee_profile_id uuid not null references app.runner_profile (runner_profile_id) on delete restrict,
  status text not null default 'PENDING' check (status in ('PENDING', 'ACCEPTED', 'REJECTED', 'REMOVED')),
  requested_at timestamptz not null default now(),
  responded_at timestamptz null,
  removed_at timestamptz null,
  constraint friendship_not_self check (requester_profile_id <> addressee_profile_id),
  constraint friendship_removed_at check (status <> 'REMOVED' or removed_at is not null)
);
alter table app.friendship enable row level security;

create unique index friendship_live_pair_uidx on app.friendship
  (least(requester_profile_id, addressee_profile_id), greatest(requester_profile_id, addressee_profile_id))
  where status in ('PENDING', 'ACCEPTED');

create table app.guest_participant (
  guest_participant_id uuid primary key default gen_random_uuid(),
  owner_profile_id uuid not null references app.runner_profile (runner_profile_id) on delete restrict,
  full_name text not null check (btrim(full_name) <> ''),
  date_of_birth date not null,
  sex_code text not null,
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  emergency_contact_name text not null,
  emergency_contact_phone_e164 text not null check (emergency_contact_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  emergency_contact_relationship text not null,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'ARCHIVED')),
  last_event_end_at timestamptz null,
  archive_after timestamptz null,
  archived_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint guest_participant_archived_at check ((status = 'ARCHIVED') = (archived_at is not null))
);
alter table app.guest_participant enable row level security;

create trigger touch_updated_at before update on app.guest_participant
  for each row execute function private.touch_updated_at();

create table app.guardian_assignment (
  guardian_assignment_id uuid primary key default gen_random_uuid(),
  minor_runner_profile_id uuid null references app.runner_profile (runner_profile_id) on delete restrict,
  minor_guest_participant_id uuid null references app.guest_participant (guest_participant_id) on delete restrict,
  guardian_profile_id uuid not null references app.runner_profile (runner_profile_id) on delete restrict,
  relationship_type text not null,
  status text not null default 'PENDING' check (status in ('PENDING', 'ACTIVE', 'REVOKED')),
  created_at timestamptz not null default now(),
  activated_at timestamptz null,
  revoked_at timestamptz null,
  constraint guardian_assignment_one_minor
    check (num_nonnulls(minor_runner_profile_id, minor_guest_participant_id) = 1),
  constraint guardian_assignment_not_self
    check (minor_runner_profile_id is distinct from guardian_profile_id),
  constraint guardian_assignment_active_at check (status <> 'ACTIVE' or activated_at is not null),
  constraint guardian_assignment_revoked_at check (status <> 'REVOKED' or revoked_at is not null)
);
alter table app.guardian_assignment enable row level security;

create unique index guardian_assignment_live_runner_uidx on app.guardian_assignment
  (minor_runner_profile_id, guardian_profile_id)
  where status <> 'REVOKED' and minor_runner_profile_id is not null;
create unique index guardian_assignment_live_guest_uidx on app.guardian_assignment
  (minor_guest_participant_id, guardian_profile_id)
  where status <> 'REVOKED' and minor_guest_participant_id is not null;

-- Minor/guardian identity is fixed; event verifications rely on it.
create trigger freeze_parties before update of minor_runner_profile_id, minor_guest_participant_id, guardian_profile_id
  on app.guardian_assignment for each row
  when (row(old.minor_runner_profile_id, old.minor_guest_participant_id, old.guardian_profile_id)
        is distinct from row(new.minor_runner_profile_id, new.minor_guest_participant_id, new.guardian_profile_id))
  execute function private.reject_mutation('guardian_assignment parties are immutable; revoke and create a new assignment');
