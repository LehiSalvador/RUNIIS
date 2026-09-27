-- Task Center is a projection of source conditions; readiness always recomputes from sources.
create table app.admin_task (
  admin_task_id uuid primary key default gen_random_uuid(),
  task_key text not null unique,
  category text not null,
  scope_type text not null,
  scope_id uuid null,
  edition_id uuid null references app.edition (edition_id) on delete restrict,
  related_entity_type text null,
  related_entity_id uuid null,
  title text not null,
  description text not null,
  priority text not null,
  blocking_level text not null
    check (blocking_level in ('INFORMATION', 'ACTION_REQUIRED', 'EVENT_DAY_BLOCKER', 'CLOSURE_BLOCKER')),
  status text not null default 'OPEN' check (status in ('OPEN', 'IN_PROGRESS', 'WAITING_EXTERNAL', 'RESOLVED', 'WAIVED')),
  assigned_role text null check (assigned_role in ('ADMIN', 'OPERATOR', 'CHECKIN', 'MODERATOR')),
  assigned_staff_id uuid null references app.staff_member (staff_member_id) on delete restrict,
  detected_at timestamptz not null default now(),
  due_at timestamptz null,
  started_at timestamptz null,
  resolved_at timestamptz null,
  resolution_type text null,
  resolution_reason text null,
  source_rule text not null,
  metadata jsonb not null default '{}' check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint admin_task_resolved_at check ((status in ('RESOLVED', 'WAIVED')) = (resolved_at is not null))
);
alter table app.admin_task enable row level security;

create trigger touch_updated_at before update on app.admin_task
  for each row execute function private.touch_updated_at();
