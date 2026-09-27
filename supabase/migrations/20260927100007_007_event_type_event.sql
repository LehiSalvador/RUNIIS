create table app.event_type (
  event_type_id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[A-Z][A-Z0-9_]*$'),
  name text not null,
  default_generates_distance_credit boolean not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table app.event_type enable row level security;

create trigger touch_updated_at before update on app.event_type
  for each row execute function private.touch_updated_at();

create table app.event (
  event_id uuid primary key default gen_random_uuid(),
  event_type_id uuid not null references app.event_type (event_type_id) on delete restrict,
  name text not null check (btrim(name) <> ''),
  canonical_key text not null unique,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'ARCHIVED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table app.event enable row level security;

create trigger touch_updated_at before update on app.event
  for each row execute function private.touch_updated_at();
