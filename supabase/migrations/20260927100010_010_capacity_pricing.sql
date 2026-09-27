-- Availability is always computed inside the locking transaction; nothing here stores free slots.
create table app.modality_capacity (
  modality_id uuid primary key references app.modality (modality_id) on delete restrict,
  effective_capacity integer not null check (effective_capacity >= 0),
  updated_at timestamptz not null default now(),
  updated_by_staff_id uuid null references app.staff_member (staff_member_id) on delete restrict
);
alter table app.modality_capacity enable row level security;

create trigger touch_updated_at before update on app.modality_capacity
  for each row execute function private.touch_updated_at();

create table app.price_offer (
  price_offer_id uuid primary key default gen_random_uuid(),
  modality_id uuid not null references app.modality (modality_id) on delete restrict,
  name text not null,
  amount_minor bigint not null check (amount_minor >= 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  starts_at timestamptz null,
  ends_at timestamptz null,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE', 'EXPIRED')),
  priority integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (modality_id, price_offer_id),
  constraint price_offer_window check (ends_at is null or starts_at is null or ends_at > starts_at)
);
alter table app.price_offer enable row level security;

create trigger touch_updated_at before update on app.price_offer
  for each row execute function private.touch_updated_at();
