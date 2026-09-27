create table app.edition (
  edition_id uuid primary key default gen_random_uuid(),
  event_id uuid not null references app.event (event_id) on delete restrict,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (btrim(name) <> ''),
  publication_state text not null default 'DRAFT'
    check (publication_state in ('DRAFT', 'PUBLISHED', 'HIDDEN')),
  registration_state text not null default 'NOT_OPEN'
    check (registration_state in ('NOT_OPEN', 'OPEN', 'PAUSED', 'CLOSED')),
  execution_state text not null default 'SCHEDULED'
    check (execution_state in ('SCHEDULED', 'POSTPONED', 'IN_PROGRESS', 'FINISHED', 'CANCELED')),
  closure_state text not null default 'OPEN' check (closure_state in ('OPEN', 'PENDING', 'CLOSED')),
  registration_mode text not null check (registration_mode in ('FREE', 'EXTERNAL_WHATSAPP')),
  timezone text not null check (private.is_iana_timezone(timezone)),
  registration_open_at timestamptz null,
  registration_close_at timestamptz not null,
  global_capacity integer null check (global_capacity is null or global_capacity >= 0),
  city text not null,
  state_region text not null,
  country_code char(2) not null check (country_code ~ '^[A-Z]{2}$'),
  primary_location_id uuid null,
  whatsapp_phone_e164 text null check (whatsapp_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  is_benefit_event boolean not null default false,
  published_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint edition_registration_window
    check (registration_open_at is null or registration_open_at < registration_close_at),
  constraint edition_published_at check (publication_state = 'DRAFT' or published_at is not null)
);
alter table app.edition enable row level security;

create trigger touch_updated_at before update on app.edition
  for each row execute function private.touch_updated_at();

create table app.edition_slug_history (
  edition_slug_history_id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references app.edition (edition_id) on delete restrict,
  old_slug text not null unique,
  new_slug text not null,
  changed_at timestamptz not null default now(),
  constraint edition_slug_history_changed check (old_slug <> new_slug)
);
alter table app.edition_slug_history enable row level security;

create table app.edition_schedule_revision (
  edition_schedule_revision_id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references app.edition (edition_id) on delete restrict,
  revision integer not null check (revision > 0),
  schedule_state text not null
    check (schedule_state in ('DATE_CONFIRMED_TIME_PENDING', 'DATE_TIME_CONFIRMED', 'POSTPONED_NO_NEW_DATE')),
  local_date date null,
  local_start_time time null,
  local_end_time time null,
  timezone text not null check (private.is_iana_timezone(timezone)),
  effective_start_at timestamptz null,
  effective_end_at timestamptz null,
  reason text null,
  created_by_staff_id uuid not null references app.staff_member (staff_member_id) on delete restrict,
  created_at timestamptz not null default now(),
  superseded_at timestamptz null,
  unique (edition_id, revision),
  -- Never invent a date or a 00:00 start: each state carries exactly the data it asserts.
  constraint edition_schedule_revision_state_data check (
    case schedule_state
      when 'DATE_TIME_CONFIRMED' then local_date is not null and local_start_time is not null
      when 'DATE_CONFIRMED_TIME_PENDING' then local_date is not null and local_start_time is null
      else local_date is null and local_start_time is null
    end),
  constraint edition_schedule_revision_effective_range
    check (effective_end_at is null or effective_start_at is null or effective_end_at >= effective_start_at)
);
alter table app.edition_schedule_revision enable row level security;

create unique index edition_schedule_revision_current_uidx on app.edition_schedule_revision (edition_id)
  where superseded_at is null;

create trigger append_only before update on app.edition_schedule_revision
  for each row execute function private.enforce_append_only('superseded_at');
create trigger reject_delete before delete on app.edition_schedule_revision
  for each row execute function private.reject_mutation();

create table app.edition_location (
  edition_location_id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references app.edition (edition_id) on delete restrict,
  location_type text not null
    check (location_type in ('DISCOVERY', 'VENUE', 'START', 'FINISH', 'MEETING_POINT', 'PARKING', 'KIT_PICKUP', 'OTHER')),
  name text not null,
  address_line text null,
  city text null,
  state_region text null,
  country_code char(2) null check (country_code ~ '^[A-Z]{2}$'),
  geometry extensions.geography(Point, 4326) null,
  is_primary boolean not null default false,
  sort_order integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (edition_id, edition_location_id)
);
alter table app.edition_location enable row level security;

create unique index edition_location_primary_uidx on app.edition_location (edition_id) where is_primary;

create trigger touch_updated_at before update on app.edition_location
  for each row execute function private.touch_updated_at();

alter table app.edition
  add constraint edition_primary_location_fk foreign key (edition_id, primary_location_id)
  references app.edition_location (edition_id, edition_location_id) on delete restrict;

-- modality_id FK is added in 009.
create table app.edition_schedule_item (
  edition_schedule_item_id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references app.edition (edition_id) on delete restrict,
  modality_id uuid null,
  title text not null,
  description text null,
  local_date date not null,
  local_start_time time null,
  local_end_time time null,
  location_id uuid null,
  sort_order integer not null,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'CANCELED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint edition_schedule_item_location_fk foreign key (edition_id, location_id)
    references app.edition_location (edition_id, edition_location_id) on delete restrict
);
alter table app.edition_schedule_item enable row level security;

create trigger touch_updated_at before update on app.edition_schedule_item
  for each row execute function private.touch_updated_at();

alter table app.staff_role_assignment
  add constraint staff_role_assignment_edition_fk foreign key (edition_id)
  references app.edition (edition_id) on delete restrict;

alter table app.legal_acceptance
  add constraint legal_acceptance_edition_fk foreign key (edition_id)
  references app.edition (edition_id) on delete restrict;
