create table audit.audit_log (
  audit_log_id uuid primary key default gen_random_uuid(),
  actor_auth_user_id uuid null,
  actor_staff_member_id uuid null,
  actor_role text null,
  action text not null,
  entity_type text not null,
  entity_id uuid null,
  edition_id uuid null,
  before_snapshot jsonb null,
  after_snapshot jsonb null,
  reason text null,
  correlation_id uuid null,
  request_id uuid null,
  occurred_at timestamptz not null default now()
);
alter table audit.audit_log enable row level security;
revoke truncate on audit.audit_log from public, anon, authenticated, service_role;

create trigger append_only before update or delete on audit.audit_log
  for each row execute function private.reject_mutation();
create trigger append_only_truncate before truncate on audit.audit_log
  for each statement execute function private.reject_mutation();

create table infra.outbox_event (
  outbox_event_id uuid primary key default gen_random_uuid(),
  event_type text not null,
  aggregate_type text not null,
  aggregate_id uuid not null,
  effect_key text not null unique,
  payload jsonb not null,
  status text not null default 'PENDING' check (status in ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED', 'ESCALATED')),
  available_at timestamptz not null default now(),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  claimed_by text null,
  claimed_at timestamptz null,
  claim_expires_at timestamptz null,
  processed_at timestamptz null,
  last_error text null,
  created_at timestamptz not null default now(),
  constraint outbox_event_processing_claim
    check (status <> 'PROCESSING' or (claimed_by is not null and claim_expires_at is not null)),
  constraint outbox_event_processed_at check (status <> 'PROCESSED' or processed_at is not null)
);
alter table infra.outbox_event enable row level security;

-- NULL actor is the SYSTEM namespace; NULLS NOT DISTINCT keeps it unique too.
create table infra.idempotency_record (
  idempotency_record_id uuid primary key default gen_random_uuid(),
  actor_auth_user_id uuid null,
  operation_key text not null,
  resource_scope text not null,
  idempotency_key text not null check (idempotency_key <> ''),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  state text not null,
  lease_owner text null,
  lease_expires_at timestamptz null,
  response_status integer null check (response_status between 100 and 599),
  response_body jsonb null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint idempotency_record_key_uq unique nulls not distinct
    (actor_auth_user_id, operation_key, resource_scope, idempotency_key),
  constraint idempotency_record_expiry check (expires_at > created_at)
);
alter table infra.idempotency_record enable row level security;

create table infra.worker_run (
  worker_run_id uuid primary key default gen_random_uuid(),
  worker_key text not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz null,
  status text not null default 'RUNNING' check (status in ('RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED')),
  processed_count integer not null default 0 check (processed_count >= 0),
  error_count integer not null default 0 check (error_count >= 0),
  cursor_metadata jsonb not null default '{}' check (jsonb_typeof(cursor_metadata) = 'object'),
  metadata jsonb not null default '{}' check (jsonb_typeof(metadata) = 'object'),
  constraint worker_run_completed_at check (status = 'RUNNING' or completed_at is not null)
);
alter table infra.worker_run enable row level security;

create table infra.rate_limit_counter (
  scope text not null,
  subject text not null,
  window_start timestamptz not null,
  hit_count integer not null default 0 check (hit_count >= 0),
  primary key (scope, subject, window_start)
);
alter table infra.rate_limit_counter enable row level security;
