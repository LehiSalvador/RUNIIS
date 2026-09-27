create table app.runner_profile (
  runner_profile_id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users (id) on delete restrict,
  profile_readiness text not null default 'PROFILE_INCOMPLETE'
    check (profile_readiness in ('PROFILE_INCOMPLETE', 'READY')),
  account_state text not null default 'ACTIVE'
    check (account_state in ('ACTIVE', 'IDENTITY_LOCKED', 'BANNED', 'DEACTIVATED')),
  full_name text null check (full_name is null or btrim(full_name) <> ''),
  search_name text null,
  date_of_birth date null,
  sex_code text null,
  phone_e164 text null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  emergency_contact_name text null,
  emergency_contact_phone_e164 text null check (emergency_contact_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  emergency_contact_relationship text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ready_at timestamptz null,
  -- READY requires every universal field; no placeholders are ever stored.
  constraint runner_profile_ready_complete check (
    profile_readiness <> 'READY' or (
      full_name is not null and date_of_birth is not null and sex_code is not null
      and phone_e164 is not null and emergency_contact_name is not null
      and emergency_contact_phone_e164 is not null and emergency_contact_relationship is not null
      and ready_at is not null))
);
alter table app.runner_profile enable row level security;

create trigger touch_updated_at before update on app.runner_profile
  for each row execute function private.touch_updated_at();

-- Definer so writers need no EXECUTE on private.normalize_search_text.
create function private.derive_runner_search_name()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.search_name := private.normalize_search_text(new.full_name);
  return new;
end;
$$;

create trigger derive_search_name before insert or update of full_name, search_name on app.runner_profile
  for each row execute function private.derive_runner_search_name();
