create table app.staff_member (
  staff_member_id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users (id) on delete restrict,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'REVOKED')),
  created_at timestamptz not null default now()
);
alter table app.staff_member enable row level security;

-- edition_id FK is added in 008 once app.edition exists.
create table app.staff_role_assignment (
  staff_role_assignment_id uuid primary key default gen_random_uuid(),
  staff_member_id uuid not null references app.staff_member (staff_member_id) on delete restrict,
  role text not null check (role in ('ADMIN', 'OPERATOR', 'CHECKIN', 'MODERATOR')),
  scope_type text not null check (scope_type in ('GLOBAL', 'EDITION')),
  edition_id uuid null,
  created_at timestamptz not null default now(),
  created_by_staff_id uuid null references app.staff_member (staff_member_id) on delete restrict,
  revoked_at timestamptz null,
  revoked_by_staff_id uuid null references app.staff_member (staff_member_id) on delete restrict,
  constraint staff_role_assignment_scope check ((scope_type = 'EDITION') = (edition_id is not null)),
  constraint staff_role_assignment_revoked_at check (revoked_by_staff_id is null or revoked_at is not null)
);
alter table app.staff_role_assignment enable row level security;

create unique index staff_role_assignment_live_uidx on app.staff_role_assignment
  (staff_member_id, role, edition_id) nulls not distinct
  where revoked_at is null;

create table app.account_sanction (
  sanction_id uuid primary key default gen_random_uuid(),
  runner_profile_id uuid not null references app.runner_profile (runner_profile_id) on delete restrict,
  sanction_type text not null
    check (sanction_type in ('AVATAR_UPLOAD_SUSPENSION', 'IDENTITY_REVIEW_LOCK', 'PLATFORM_BAN')),
  status text not null,
  reason text not null check (btrim(reason) <> ''),
  starts_at timestamptz not null default now(),
  ends_at timestamptz null,
  imposed_by_staff_id uuid not null references app.staff_member (staff_member_id) on delete restrict,
  revoked_at timestamptz null,
  revoked_by_staff_id uuid null references app.staff_member (staff_member_id) on delete restrict,
  revoke_reason text null,
  created_at timestamptz not null default now(),
  constraint account_sanction_window check (ends_at is null or ends_at > starts_at),
  constraint account_sanction_revoked_at check (revoked_by_staff_id is null or revoked_at is not null)
);
alter table app.account_sanction enable row level security;

create table private.blocked_identity (
  blocked_identity_id uuid primary key default gen_random_uuid(),
  runner_profile_id uuid not null references app.runner_profile (runner_profile_id) on delete restrict,
  normalized_email text null check (normalized_email = lower(btrim(normalized_email))),
  oauth_provider text null,
  oauth_subject text null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  revoked_at timestamptz null,
  constraint blocked_identity_oauth_pair check ((oauth_provider is null) = (oauth_subject is null)),
  constraint blocked_identity_has_identifier check (normalized_email is not null or oauth_subject is not null),
  constraint blocked_identity_revoked_at check (active = (revoked_at is null))
);
alter table private.blocked_identity enable row level security;
