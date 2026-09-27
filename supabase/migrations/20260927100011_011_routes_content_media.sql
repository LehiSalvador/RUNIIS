-- active_revision_id FK is added below once app.route_revision exists.
create table app.route (
  route_id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references app.edition (edition_id) on delete restrict,
  name text not null,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
  active_revision_id uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (edition_id, route_id)
);
alter table app.route enable row level security;

create trigger touch_updated_at before update on app.route
  for each row execute function private.touch_updated_at();
create trigger freeze_edition before update of edition_id on app.route
  for each row when (old.edition_id is distinct from new.edition_id)
  execute function private.reject_mutation('edition scope is immutable');

-- edition_id is carried so route and modality are pinned to the same Edition by composite FKs.
create table app.route_modality (
  route_id uuid not null,
  modality_id uuid not null,
  edition_id uuid not null,
  primary key (route_id, modality_id),
  foreign key (edition_id, route_id) references app.route (edition_id, route_id) on delete restrict,
  foreign key (edition_id, modality_id) references app.modality (edition_id, modality_id) on delete restrict
);
alter table app.route_modality enable row level security;

create table app.route_revision (
  route_revision_id uuid primary key default gen_random_uuid(),
  route_id uuid not null references app.route (route_id) on delete restrict,
  revision integer not null check (revision > 0),
  status text not null default 'DRAFT' check (status in ('DRAFT', 'PUBLISHED', 'SUPERSEDED')),
  geometry extensions.geometry(LineString, 4326) not null,
  geojson_snapshot jsonb not null,
  computed_distance_m integer null check (computed_distance_m is null or computed_distance_m >= 0),
  source text not null check (source in ('MANUAL', 'GPX_IMPORT', 'DUPLICATED')),
  source_filename text null,
  validation_result jsonb not null default '{}' check (jsonb_typeof(validation_result) = 'object'),
  created_by_staff_id uuid not null references app.staff_member (staff_member_id) on delete restrict,
  created_at timestamptz not null default now(),
  published_at timestamptz null,
  superseded_at timestamptz null,
  unique (route_id, revision),
  unique (route_id, route_revision_id),
  constraint route_revision_published_at check (status <> 'PUBLISHED' or published_at is not null),
  constraint route_revision_superseded_at check ((status = 'SUPERSEDED') = (superseded_at is not null))
);
alter table app.route_revision enable row level security;

create unique index route_revision_published_uidx on app.route_revision (route_id) where status = 'PUBLISHED';

alter table app.route
  add constraint route_active_revision_fk foreign key (route_id, active_revision_id)
  references app.route_revision (route_id, route_revision_id) on delete restrict;

create table app.route_poi (
  route_poi_id uuid primary key default gen_random_uuid(),
  route_revision_id uuid not null references app.route_revision (route_revision_id) on delete restrict,
  poi_type text not null
    check (poi_type in ('START', 'FINISH', 'HYDRATION', 'MEDICAL', 'CHECKPOINT', 'RESTROOM', 'VIEWPOINT', 'OTHER')),
  name text not null,
  geometry extensions.geography(Point, 4326) not null,
  sort_order integer not null,
  metadata jsonb not null default '{}' check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);
alter table app.route_poi enable row level security;

create table app.event_content_block (
  event_content_block_id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references app.edition (edition_id) on delete restrict,
  modality_id uuid null,
  block_type text not null
    check (block_type in ('RICH_TEXT', 'CALLOUT', 'IMAGE', 'GALLERY', 'FAQ', 'DOCUMENT_LINK', 'SPONSOR_GROUP', 'CUSTOM_SECTION')),
  position integer not null,
  status text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_content_block_modality_fk foreign key (edition_id, modality_id)
    references app.modality (edition_id, modality_id) on delete restrict
);
alter table app.event_content_block enable row level security;

create trigger touch_updated_at before update on app.event_content_block
  for each row execute function private.touch_updated_at();

create table app.event_media_asset (
  event_media_asset_id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references app.edition (edition_id) on delete restrict,
  media_type text not null,
  storage_object_key text not null,
  alt_text text not null,
  status text not null default 'PENDING' check (status in ('PENDING', 'PUBLISHED', 'ARCHIVED')),
  sort_order integer not null,
  focal_point jsonb null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table app.event_media_asset enable row level security;

create trigger touch_updated_at before update on app.event_media_asset
  for each row execute function private.touch_updated_at();
