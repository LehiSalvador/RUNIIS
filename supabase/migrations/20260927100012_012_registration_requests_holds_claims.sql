create table app.registration_request (
  registration_request_id uuid primary key default gen_random_uuid(),
  public_reference text not null unique,
  buyer_profile_id uuid not null references app.runner_profile (runner_profile_id) on delete restrict,
  edition_id uuid not null references app.edition (edition_id) on delete restrict,
  status text not null default 'PENDING_CONFIRMATION'
    check (status in ('PENDING_CONFIRMATION', 'CONFIRMED', 'CANCELED_BY_BUYER', 'CANCELED_BY_STAFF', 'EXPIRED')),
  registration_mode text not null check (registration_mode in ('FREE', 'EXTERNAL_WHATSAPP')),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  total_snapshot_minor bigint not null check (total_snapshot_minor >= 0),
  whatsapp_phone_snapshot text null check (whatsapp_phone_snapshot ~ '^\+[1-9][0-9]{7,14}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz null,
  confirmed_at timestamptz null,
  canceled_at timestamptz null,
  canceled_by_profile_id uuid null references app.runner_profile (runner_profile_id) on delete restrict,
  canceled_by_staff_id uuid null references app.staff_member (staff_member_id) on delete restrict,
  cancel_reason text null,
  revalidated_from_expired boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (registration_request_id, edition_id),
  unique (registration_request_id, edition_id, buyer_profile_id),
  constraint registration_request_whatsapp_expiry
    check (registration_mode <> 'EXTERNAL_WHATSAPP' or expires_at is not null),
  constraint registration_request_expiry_after_creation check (expires_at is null or expires_at > created_at),
  constraint registration_request_confirmed_at check (status <> 'CONFIRMED' or confirmed_at is not null),
  constraint registration_request_canceled_by_buyer
    check (status <> 'CANCELED_BY_BUYER' or (canceled_at is not null and canceled_by_profile_id is not null)),
  constraint registration_request_canceled_by_staff
    check (status <> 'CANCELED_BY_STAFF' or (canceled_at is not null and canceled_by_staff_id is not null))
);
alter table app.registration_request enable row level security;

-- One effective pending request per buyer and Edition; expired rows are materialised before the check.
create unique index registration_request_buyer_pending_uidx on app.registration_request (buyer_profile_id, edition_id)
  where status = 'PENDING_CONFIRMATION';

create trigger touch_updated_at before update on app.registration_request
  for each row execute function private.touch_updated_at();
create trigger freeze_scope before update of edition_id, buyer_profile_id on app.registration_request
  for each row when (row(old.edition_id, old.buyer_profile_id) is distinct from row(new.edition_id, new.buyer_profile_id))
  execute function private.reject_mutation('request scope is immutable');
create trigger reject_delete before delete on app.registration_request
  for each row execute function private.reject_mutation();
create trigger reject_truncate before truncate on app.registration_request
  for each statement execute function private.reject_mutation();

create table app.registration_request_participant (
  request_participant_id uuid primary key default gen_random_uuid(),
  registration_request_id uuid not null
    references app.registration_request (registration_request_id) on delete restrict,
  participant_kind text not null check (participant_kind in ('PROFILE', 'GUEST')),
  runner_profile_id uuid null references app.runner_profile (runner_profile_id) on delete restrict,
  guest_participant_id uuid null references app.guest_participant (guest_participant_id) on delete restrict,
  modality_id uuid not null references app.modality (modality_id) on delete restrict,
  category_id uuid null references app.category (category_id) on delete restrict,
  price_offer_id uuid null,
  price_snapshot_minor bigint not null check (price_snapshot_minor >= 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  eligibility_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  unique (request_participant_id, registration_request_id),
  unique (registration_request_id, runner_profile_id),
  unique (registration_request_id, guest_participant_id),
  constraint registration_request_participant_kind check (
    (participant_kind = 'PROFILE' and runner_profile_id is not null and guest_participant_id is null)
    or (participant_kind = 'GUEST' and guest_participant_id is not null and runner_profile_id is null)),
  constraint registration_request_participant_price_offer_fk foreign key (modality_id, price_offer_id)
    references app.price_offer (modality_id, price_offer_id) on delete restrict
);
alter table app.registration_request_participant enable row level security;

-- Snapshot of what was requested; registrations and responses stay linked to it.
create trigger append_only before update or delete on app.registration_request_participant
  for each row execute function private.reject_mutation();
create trigger append_only_truncate before truncate on app.registration_request_participant
  for each statement execute function private.reject_mutation();

create function private.check_request_participant_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_edition_id uuid;
begin
  select r.edition_id into request_edition_id
  from app.registration_request r
  where r.registration_request_id = new.registration_request_id;

  if not exists (select 1 from app.modality m where m.modality_id = new.modality_id and m.edition_id = request_edition_id)
     or (new.category_id is not null and not exists (
           select 1 from app.category c where c.category_id = new.category_id and c.edition_id = request_edition_id)) then
    raise exception using errcode = 'foreign_key_violation',
      message = 'cross-edition reference: request participant modality/category must belong to the request Edition';
  end if;
  return null;
end;
$$;

create constraint trigger check_scope after insert on app.registration_request_participant
  for each row execute function private.check_request_participant_scope();

-- Materialised participant claim (Master §66): at most one ACTIVE claim per Edition + participant.
create table app.registration_participant_claim (
  claim_id uuid primary key default gen_random_uuid(),
  edition_id uuid not null,
  registration_request_id uuid not null,
  request_participant_id uuid not null,
  runner_profile_id uuid null references app.runner_profile (runner_profile_id) on delete restrict,
  guest_participant_id uuid null references app.guest_participant (guest_participant_id) on delete restrict,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'CONSUMED', 'RELEASED', 'EXPIRED')),
  -- NULL for FREE requests, whose claim is consumed in the same transaction.
  expires_at timestamptz null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz null,
  constraint registration_participant_claim_one_target check (num_nonnulls(runner_profile_id, guest_participant_id) = 1),
  constraint registration_participant_claim_resolved_at check ((status = 'ACTIVE') = (resolved_at is null)),
  constraint registration_participant_claim_request_fk foreign key (registration_request_id, edition_id)
    references app.registration_request (registration_request_id, edition_id) on delete restrict,
  constraint registration_participant_claim_participant_fk foreign key (request_participant_id, registration_request_id)
    references app.registration_request_participant (request_participant_id, registration_request_id) on delete restrict
);
alter table app.registration_participant_claim enable row level security;

create unique index registration_participant_claim_active_profile_uidx
  on app.registration_participant_claim (edition_id, runner_profile_id)
  where status = 'ACTIVE' and runner_profile_id is not null;
create unique index registration_participant_claim_active_guest_uidx
  on app.registration_participant_claim (edition_id, guest_participant_id)
  where status = 'ACTIVE' and guest_participant_id is not null;

create function private.check_participant_claim_match()
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
      message = 'participant claim must name the same runner/guest as its request participant';
  end if;
  return null;
end;
$$;

create constraint trigger check_participant after insert or update of request_participant_id, runner_profile_id, guest_participant_id
  on app.registration_participant_claim
  for each row execute function private.check_participant_claim_match();

create table app.registration_hold (
  registration_hold_id uuid primary key default gen_random_uuid(),
  registration_request_id uuid not null
    references app.registration_request (registration_request_id) on delete restrict,
  modality_id uuid not null references app.modality (modality_id) on delete restrict,
  quantity integer not null check (quantity > 0),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'CONSUMED', 'EXPIRED', 'RELEASED')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  consumed_at timestamptz null,
  released_at timestamptz null,
  unique (registration_request_id, modality_id),
  constraint registration_hold_expiry_after_creation check (expires_at > created_at),
  constraint registration_hold_consumed_at check (status <> 'CONSUMED' or consumed_at is not null),
  constraint registration_hold_released_at check (status <> 'RELEASED' or released_at is not null)
);
alter table app.registration_hold enable row level security;

create function private.check_hold_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from app.registration_request r
    join app.modality m on m.edition_id = r.edition_id
    where r.registration_request_id = new.registration_request_id and m.modality_id = new.modality_id) then
    raise exception using errcode = 'foreign_key_violation',
      message = 'cross-edition reference: hold modality must belong to the request Edition';
  end if;
  return null;
end;
$$;

create constraint trigger check_scope after insert or update of registration_request_id, modality_id
  on app.registration_hold
  for each row execute function private.check_hold_scope();

create table app.registration_field_response (
  registration_field_response_id uuid primary key default gen_random_uuid(),
  request_participant_id uuid not null
    references app.registration_request_participant (request_participant_id) on delete restrict,
  registration_form_field_id uuid not null
    references app.registration_form_field (registration_form_field_id) on delete restrict,
  value_json jsonb not null,
  field_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (request_participant_id, registration_form_field_id)
);
alter table app.registration_field_response enable row level security;

create trigger touch_updated_at before update on app.registration_field_response
  for each row execute function private.touch_updated_at();

create function private.check_field_response_scope()
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
    join app.registration_form f on f.edition_id = r.edition_id
      and (f.modality_id is null or f.modality_id = p.modality_id)
    join app.registration_form_field ff on ff.registration_form_id = f.registration_form_id
    where p.request_participant_id = new.request_participant_id
      and ff.registration_form_field_id = new.registration_form_field_id) then
    raise exception using errcode = 'foreign_key_violation',
      message = 'cross-scope reference: form field must belong to the participant''s Edition and Modality';
  end if;
  return null;
end;
$$;

create constraint trigger check_scope after insert or update of request_participant_id, registration_form_field_id
  on app.registration_field_response
  for each row execute function private.check_field_response_scope();

alter table app.legal_acceptance
  add constraint legal_acceptance_registration_request_fk foreign key (registration_request_id)
    references app.registration_request (registration_request_id) on delete restrict,
  add constraint legal_acceptance_request_edition_fk foreign key (registration_request_id, edition_id)
    references app.registration_request (registration_request_id, edition_id) on delete restrict;
