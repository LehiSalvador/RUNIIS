create table app.registration_confirmation (
  registration_confirmation_id uuid primary key default gen_random_uuid(),
  registration_request_id uuid not null unique
    references app.registration_request (registration_request_id) on delete restrict,
  confirmation_method text not null check (confirmation_method in ('EXTERNAL_WHATSAPP', 'FREE_AUTO')),
  confirmed_by_staff_id uuid null references app.staff_member (staff_member_id) on delete restrict,
  confirmed_at timestamptz not null default now(),
  notes text null,
  constraint registration_confirmation_actor
    check ((confirmation_method = 'EXTERNAL_WHATSAPP') = (confirmed_by_staff_id is not null))
);
alter table app.registration_confirmation enable row level security;

create trigger append_only before update on app.registration_confirmation
  for each row execute function private.enforce_append_only('notes');
create trigger reject_delete before delete on app.registration_confirmation
  for each row execute function private.reject_mutation();

create table app.registration (
  registration_id uuid primary key default gen_random_uuid(),
  registration_request_id uuid not null,
  request_participant_id uuid not null unique,
  edition_id uuid not null references app.edition (edition_id) on delete restrict,
  modality_id uuid not null,
  runner_profile_id uuid null references app.runner_profile (runner_profile_id) on delete restrict,
  guest_participant_id uuid null references app.guest_participant (guest_participant_id) on delete restrict,
  buyer_profile_id uuid not null references app.runner_profile (runner_profile_id) on delete restrict,
  registration_number text not null unique,
  status text not null default 'CONFIRMED' check (status in ('CONFIRMED', 'CANCELED')),
  confirmed_at timestamptz not null default now(),
  canceled_at timestamptz null,
  cancel_reason text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (registration_id, edition_id),
  unique (registration_id, edition_id, runner_profile_id),
  constraint registration_one_participant check (num_nonnulls(runner_profile_id, guest_participant_id) = 1),
  constraint registration_canceled_at check ((status = 'CANCELED') = (canceled_at is not null)),
  -- One FK pins request, Edition and buyer together.
  constraint registration_request_fk foreign key (registration_request_id, edition_id, buyer_profile_id)
    references app.registration_request (registration_request_id, edition_id, buyer_profile_id) on delete restrict,
  constraint registration_participant_fk foreign key (request_participant_id, registration_request_id)
    references app.registration_request_participant (request_participant_id, registration_request_id) on delete restrict,
  constraint registration_modality_fk foreign key (edition_id, modality_id)
    references app.modality (edition_id, modality_id) on delete restrict
);
alter table app.registration enable row level security;

create unique index registration_confirmed_profile_uidx on app.registration (edition_id, runner_profile_id)
  where status = 'CONFIRMED' and runner_profile_id is not null;
create unique index registration_confirmed_guest_uidx on app.registration (edition_id, guest_participant_id)
  where status = 'CONFIRMED' and guest_participant_id is not null;

create trigger touch_updated_at before update on app.registration
  for each row execute function private.touch_updated_at();
create trigger freeze_identity
  before update of registration_request_id, request_participant_id, edition_id, runner_profile_id, guest_participant_id, buyer_profile_id
  on app.registration for each row
  when (row(old.registration_request_id, old.request_participant_id, old.edition_id,
            old.runner_profile_id, old.guest_participant_id, old.buyer_profile_id)
        is distinct from row(new.registration_request_id, new.request_participant_id, new.edition_id,
                             new.runner_profile_id, new.guest_participant_id, new.buyer_profile_id))
  execute function private.reject_mutation('registration identity is immutable');
create trigger reject_delete before delete on app.registration
  for each row execute function private.reject_mutation();
create trigger reject_truncate before truncate on app.registration
  for each statement execute function private.reject_mutation();

create function private.check_registration_participant_match()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from app.registration_request_participant p
    where p.request_participant_id = new.request_participant_id
      and p.runner_profile_id is not distinct from new.runner_profile_id
      and p.guest_participant_id is not distinct from new.guest_participant_id) then
    raise exception using errcode = 'foreign_key_violation',
      message = 'registration must name the same runner/guest as its request participant';
  end if;
  return null;
end;
$$;

create constraint trigger check_participant after insert on app.registration
  for each row execute function private.check_registration_participant_match();

-- Shared by children that reference a registration plus Edition-scoped modality/category.
create function private.check_registration_child_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  child jsonb := to_jsonb(new);
  registration_edition_id uuid;
begin
  select r.edition_id into registration_edition_id
  from app.registration r
  where r.registration_id = new.registration_id;

  if (child ->> 'category_id' is not null and not exists (
        select 1 from app.category c
        where c.category_id = (child ->> 'category_id')::uuid and c.edition_id = registration_edition_id))
     or (child ->> 'modality_id' is not null and not exists (
        select 1 from app.modality m
        where m.modality_id = (child ->> 'modality_id')::uuid and m.edition_id = registration_edition_id)) then
    raise exception using errcode = 'foreign_key_violation',
      message = format('cross-edition reference: %I modality/category must belong to the registration Edition', tg_table_name);
  end if;
  return null;
end;
$$;

create table app.registration_category_assignment (
  registration_category_assignment_id uuid primary key default gen_random_uuid(),
  registration_id uuid not null unique references app.registration (registration_id) on delete restrict,
  category_id uuid not null references app.category (category_id) on delete restrict,
  assignment_source text not null check (assignment_source in ('USER_SELECTION', 'DERIVED')),
  eligibility_snapshot jsonb not null,
  assigned_at timestamptz not null default now()
);
alter table app.registration_category_assignment enable row level security;

create constraint trigger check_scope after insert or update of registration_id, category_id
  on app.registration_category_assignment
  for each row execute function private.check_registration_child_scope();

create table app.registration_revision (
  registration_revision_id uuid primary key default gen_random_uuid(),
  registration_id uuid not null references app.registration (registration_id) on delete restrict,
  revision integer not null check (revision > 0),
  modality_id uuid not null references app.modality (modality_id) on delete restrict,
  category_id uuid null references app.category (category_id) on delete restrict,
  status text not null,
  effective_from timestamptz not null,
  reason text not null check (btrim(reason) <> ''),
  changed_by_staff_id uuid not null references app.staff_member (staff_member_id) on delete restrict,
  created_at timestamptz not null default now(),
  superseded_at timestamptz null,
  unique (registration_id, revision)
);
alter table app.registration_revision enable row level security;

create unique index registration_revision_current_uidx on app.registration_revision (registration_id)
  where superseded_at is null;

create constraint trigger check_scope after insert on app.registration_revision
  for each row execute function private.check_registration_child_scope();
create trigger append_only before update on app.registration_revision
  for each row execute function private.enforce_append_only('status', 'superseded_at');
create trigger reject_delete before delete on app.registration_revision
  for each row execute function private.reject_mutation();
