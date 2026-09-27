create table app.profile_image_asset (
  profile_image_asset_id uuid primary key default gen_random_uuid(),
  runner_profile_id uuid not null references app.runner_profile (runner_profile_id) on delete restrict,
  staging_object_key text not null,
  public_object_key text null,
  status text not null default 'PENDING_PROCESSING' check (status in (
    'PENDING_PROCESSING', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'REMOVED', 'SUPERSEDED')),
  uploaded_at timestamptz not null default now(),
  processed_at timestamptz null,
  approved_at timestamptz null,
  rejected_at timestamptz null,
  removed_at timestamptz null,
  decided_by_staff_id uuid null references app.staff_member (staff_member_id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (runner_profile_id, profile_image_asset_id),
  constraint profile_image_asset_approved
    check (status <> 'APPROVED' or (public_object_key is not null and approved_at is not null)),
  constraint profile_image_asset_rejected_at check (status <> 'REJECTED' or rejected_at is not null),
  constraint profile_image_asset_removed_at check (status <> 'REMOVED' or removed_at is not null)
);
alter table app.profile_image_asset enable row level security;

create unique index profile_image_asset_approved_uidx on app.profile_image_asset (runner_profile_id)
  where status = 'APPROVED';
create unique index profile_image_asset_pending_uidx on app.profile_image_asset (runner_profile_id)
  where status in ('PENDING_PROCESSING', 'PENDING_REVIEW');

create trigger touch_updated_at before update on app.profile_image_asset
  for each row execute function private.touch_updated_at();
create trigger freeze_owner before update of runner_profile_id on app.profile_image_asset
  for each row when (old.runner_profile_id is distinct from new.runner_profile_id)
  execute function private.reject_mutation('asset owner is immutable');

create table app.avatar_moderation_decision (
  avatar_moderation_decision_id uuid primary key default gen_random_uuid(),
  profile_image_asset_id uuid not null references app.profile_image_asset (profile_image_asset_id) on delete restrict,
  decision text not null check (decision in ('APPROVE', 'REJECT', 'REMOVE')),
  staff_member_id uuid not null references app.staff_member (staff_member_id) on delete restrict,
  reason text null,
  decided_at timestamptz not null default now()
);
alter table app.avatar_moderation_decision enable row level security;

create trigger append_only before update or delete on app.avatar_moderation_decision
  for each row execute function private.reject_mutation();
create trigger append_only_truncate before truncate on app.avatar_moderation_decision
  for each statement execute function private.reject_mutation();

-- A profile can only point at its own asset.
alter table app.community_profile
  add constraint community_profile_avatar_fk foreign key (runner_profile_id, avatar_asset_id)
  references app.profile_image_asset (runner_profile_id, profile_image_asset_id) on delete restrict;
