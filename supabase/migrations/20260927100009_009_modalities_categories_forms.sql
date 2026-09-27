create table app.modality (
  modality_id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references app.edition (edition_id) on delete restrict,
  key text not null,
  name text not null check (btrim(name) <> ''),
  -- May be NULL while drafting; > 0 is required before opening registration when credit is generated.
  official_distance_m integer null check (official_distance_m is null or official_distance_m > 0),
  generates_distance_credit boolean not null,
  local_start_time time null,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'CLOSED', 'CANCELED')),
  sort_order integer not null,
  eligibility_rule_version integer not null default 1 check (eligibility_rule_version > 0),
  eligibility_rules jsonb not null default '{}' check (jsonb_typeof(eligibility_rules) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (edition_id, key),
  unique (edition_id, modality_id)
);
alter table app.modality enable row level security;

create trigger touch_updated_at before update on app.modality
  for each row execute function private.touch_updated_at();
create trigger freeze_edition before update of edition_id on app.modality
  for each row when (old.edition_id is distinct from new.edition_id)
  execute function private.reject_mutation('edition scope is immutable');

create table app.category (
  category_id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references app.edition (edition_id) on delete restrict,
  name text not null,
  key text not null,
  eligibility_rule jsonb not null default '{}' check (jsonb_typeof(eligibility_rule) = 'object'),
  assignment_mode text not null check (assignment_mode in ('USER_SELECTS', 'SYSTEM_DERIVES')),
  active boolean not null default true,
  sort_order integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (edition_id, key),
  unique (edition_id, category_id)
);
alter table app.category enable row level security;

create trigger touch_updated_at before update on app.category
  for each row execute function private.touch_updated_at();
create trigger freeze_edition before update of edition_id on app.category
  for each row when (old.edition_id is distinct from new.edition_id)
  execute function private.reject_mutation('edition scope is immutable');

-- edition_id is carried so both composite FKs pin modality and category to one Edition.
create table app.modality_category (
  modality_id uuid not null,
  category_id uuid not null,
  edition_id uuid not null,
  primary key (modality_id, category_id),
  foreign key (edition_id, modality_id) references app.modality (edition_id, modality_id) on delete restrict,
  foreign key (edition_id, category_id) references app.category (edition_id, category_id) on delete restrict
);
alter table app.modality_category enable row level security;

create table app.registration_form (
  registration_form_id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references app.edition (edition_id) on delete restrict,
  modality_id uuid null,
  version integer not null check (version > 0),
  status text not null default 'DRAFT' check (status in ('DRAFT', 'PUBLISHED', 'SUPERSEDED')),
  created_at timestamptz not null default now(),
  published_at timestamptz null,
  constraint registration_form_modality_fk foreign key (edition_id, modality_id)
    references app.modality (edition_id, modality_id) on delete restrict,
  constraint registration_form_published_at check (status <> 'PUBLISHED' or published_at is not null)
);
alter table app.registration_form enable row level security;

create unique index registration_form_version_uidx on app.registration_form
  (edition_id, modality_id, version) nulls not distinct;
create unique index registration_form_published_uidx on app.registration_form
  (edition_id, modality_id) nulls not distinct where status = 'PUBLISHED';

create trigger freeze_scope before update of edition_id, modality_id on app.registration_form
  for each row when (row(old.edition_id, old.modality_id) is distinct from row(new.edition_id, new.modality_id))
  execute function private.reject_mutation('form scope is immutable');

create table app.registration_form_field (
  registration_form_field_id uuid primary key default gen_random_uuid(),
  registration_form_id uuid not null references app.registration_form (registration_form_id) on delete restrict,
  field_key text not null,
  label text not null,
  field_type text not null
    check (field_type in ('TEXT', 'TEXTAREA', 'SELECT', 'MULTISELECT', 'BOOLEAN', 'DATE', 'NUMBER')),
  required boolean not null,
  validation_config jsonb not null default '{}' check (jsonb_typeof(validation_config) = 'object'),
  options_config jsonb not null default '{}' check (jsonb_typeof(options_config) = 'object'),
  sensitivity text not null default 'NORMAL',
  sort_order integer not null,
  unique (registration_form_id, field_key)
);
alter table app.registration_form_field enable row level security;

create trigger freeze_form before update of registration_form_id on app.registration_form_field
  for each row when (old.registration_form_id is distinct from new.registration_form_id)
  execute function private.reject_mutation('field form is immutable');

alter table app.edition_schedule_item
  add constraint edition_schedule_item_modality_fk foreign key (edition_id, modality_id)
  references app.modality (edition_id, modality_id) on delete restrict;
