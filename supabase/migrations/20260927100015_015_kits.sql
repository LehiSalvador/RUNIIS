create table app.kit_definition (
  kit_definition_id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references app.edition (edition_id) on delete restrict,
  name text not null,
  status text not null,
  pickup_start_at timestamptz null,
  pickup_end_at timestamptz null,
  instructions text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (edition_id, kit_definition_id),
  constraint kit_definition_pickup_window
    check (pickup_end_at is null or pickup_start_at is null or pickup_end_at > pickup_start_at)
);
alter table app.kit_definition enable row level security;

create trigger touch_updated_at before update on app.kit_definition
  for each row execute function private.touch_updated_at();
create trigger freeze_edition before update of edition_id on app.kit_definition
  for each row when (old.edition_id is distinct from new.edition_id)
  execute function private.reject_mutation('edition scope is immutable');

create table app.kit_variant (
  kit_variant_id uuid primary key default gen_random_uuid(),
  kit_definition_id uuid not null references app.kit_definition (kit_definition_id) on delete restrict,
  variant_key text not null,
  label text not null,
  capacity integer null check (capacity is null or capacity >= 0),
  status text not null,
  created_at timestamptz not null default now(),
  unique (kit_definition_id, variant_key),
  unique (kit_definition_id, kit_variant_id)
);
alter table app.kit_variant enable row level security;

create function private.check_kit_selection_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from app.registration_request_participant p
    join app.registration_request r on r.registration_request_id = p.registration_request_id
    join app.kit_definition kd on kd.edition_id = r.edition_id
    where p.request_participant_id = new.request_participant_id
      and kd.kit_definition_id = new.kit_definition_id) then
    raise exception using errcode = 'foreign_key_violation',
      message = 'cross-edition reference: kit must belong to the request Edition';
  end if;
  return null;
end;
$$;

create table app.kit_selection (
  kit_selection_id uuid primary key default gen_random_uuid(),
  request_participant_id uuid not null
    references app.registration_request_participant (request_participant_id) on delete restrict,
  kit_definition_id uuid not null references app.kit_definition (kit_definition_id) on delete restrict,
  kit_variant_id uuid not null,
  selected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (request_participant_id, kit_definition_id),
  constraint kit_selection_variant_fk foreign key (kit_definition_id, kit_variant_id)
    references app.kit_variant (kit_definition_id, kit_variant_id) on delete restrict
);
alter table app.kit_selection enable row level security;

create trigger touch_updated_at before update on app.kit_selection
  for each row execute function private.touch_updated_at();
create constraint trigger check_scope after insert or update of request_participant_id, kit_definition_id
  on app.kit_selection
  for each row execute function private.check_kit_selection_scope();

create function private.check_kit_allocation_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from app.registration r
    join app.kit_definition kd on kd.edition_id = r.edition_id
    where r.registration_id = new.registration_id and kd.kit_definition_id = new.kit_definition_id) then
    raise exception using errcode = 'foreign_key_violation',
      message = 'cross-edition reference: kit must belong to the registration Edition';
  end if;
  return null;
end;
$$;

create table app.kit_allocation (
  kit_allocation_id uuid primary key default gen_random_uuid(),
  registration_id uuid not null unique references app.registration (registration_id) on delete restrict,
  kit_definition_id uuid not null references app.kit_definition (kit_definition_id) on delete restrict,
  kit_variant_id uuid not null,
  status text not null default 'ASSIGNED' check (status in ('ASSIGNED', 'READY', 'DELIVERED', 'CANCELED', 'EXCEPTION')),
  assigned_at timestamptz not null default now(),
  assigned_by_staff_id uuid null references app.staff_member (staff_member_id) on delete restrict,
  notes text null,
  updated_at timestamptz not null default now(),
  unique (kit_allocation_id, registration_id),
  constraint kit_allocation_variant_fk foreign key (kit_definition_id, kit_variant_id)
    references app.kit_variant (kit_definition_id, kit_variant_id) on delete restrict
);
alter table app.kit_allocation enable row level security;

create trigger touch_updated_at before update on app.kit_allocation
  for each row execute function private.touch_updated_at();
create constraint trigger check_scope after insert or update of registration_id, kit_definition_id
  on app.kit_allocation
  for each row execute function private.check_kit_allocation_scope();

create table app.kit_pickup (
  kit_pickup_id uuid primary key default gen_random_uuid(),
  registration_id uuid not null,
  kit_allocation_id uuid not null,
  participant_pass_credential_id uuid null
    references app.participant_pass_credential (participant_pass_credential_id) on delete restrict,
  edition_id uuid not null references app.edition (edition_id) on delete restrict,
  status text not null default 'DELIVERED' check (status in ('DELIVERED', 'REVERSED')),
  delivered_at timestamptz not null default now(),
  delivered_by_staff_id uuid not null references app.staff_member (staff_member_id) on delete restrict,
  station_key text null,
  verification_method text not null,
  third_party_reason text null,
  reversed_at timestamptz null,
  reversed_by_staff_id uuid null references app.staff_member (staff_member_id) on delete restrict,
  reversal_reason text null,
  constraint kit_pickup_registration_fk foreign key (registration_id, edition_id)
    references app.registration (registration_id, edition_id) on delete restrict,
  constraint kit_pickup_allocation_fk foreign key (kit_allocation_id, registration_id)
    references app.kit_allocation (kit_allocation_id, registration_id) on delete restrict,
  constraint kit_pickup_reversed check (
    (status = 'REVERSED') = (reversed_at is not null and reversed_by_staff_id is not null and reversal_reason is not null))
);
alter table app.kit_pickup enable row level security;

create unique index kit_pickup_delivered_uidx on app.kit_pickup (kit_allocation_id) where status = 'DELIVERED';

create trigger append_only before update on app.kit_pickup
  for each row execute function private.enforce_append_only('status', 'reversed_at', 'reversed_by_staff_id', 'reversal_reason');
create trigger reject_delete before delete on app.kit_pickup
  for each row execute function private.reject_mutation();
create trigger reject_truncate before truncate on app.kit_pickup
  for each statement execute function private.reject_mutation();
