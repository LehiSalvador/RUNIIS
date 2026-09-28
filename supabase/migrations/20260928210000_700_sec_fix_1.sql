-- SEC-FIX-1: AppSec-R1 remediation batch (F1-F10 + SEC-064 Referrer-Policy). New migration only;
-- 150-156 stay untouched. `create or replace` amends the affected functions in place.

-- ---------------------------------------------------------------------------------------------
-- F2 (SEC-080): an unauthenticated provider-event delivery must never occupy the dedupe key space
-- of the authenticated stream. The old table-level `unique(provider, provider_event_id)` blocked an
-- authentic delivery whose key a forged unauthenticated request had already claimed. Replaced by a
-- partial unique index that only constrains authenticated rows; unauthenticated rows are stored as
-- evidence only and can never pre-empt (or be blocked by) the authenticated key space.
-- ---------------------------------------------------------------------------------------------
alter table infra.communication_provider_event
  drop constraint communication_provider_event_provider_provider_event_id_key;
create unique index communication_provider_event_auth_uidx
  on infra.communication_provider_event (provider, provider_event_id) where authenticated;

create or replace function private.record_email_provider_event(
  p_provider text, p_provider_event_id text, p_provider_message_id text, p_event_type text, p_payload_safe jsonb,
  p_authenticated boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_provider not in ('brevo') or coalesce(pg_catalog.length(p_provider_event_id), 0) not between 8 and 200
     or pg_catalog.length(p_provider_message_id) > 300 or coalesce(p_event_type, '') !~ '^[a-z_]{2,40}$'
     or jsonb_typeof(p_payload_safe) is distinct from 'object' or pg_catalog.length(p_payload_safe::text) > 2048
     or p_authenticated is null then
    raise exception using errcode = 'invalid_parameter_value', message = 'invalid provider event';
  end if;
  insert into infra.communication_provider_event (provider, provider_event_id, provider_message_id, event_type,
    authenticated, payload_safe, processing_status, processed_at)
  values (p_provider, p_provider_event_id, p_provider_message_id, p_event_type, p_authenticated, p_payload_safe,
    case when p_authenticated then 'RECEIVED' else 'UNAUTHENTICATED' end,
    case when p_authenticated then null else pg_catalog.now() end)
  -- F2: this arbiter only ever fires for authenticated rows (the index predicate); an
  -- unauthenticated insert can never conflict, so it always gets its own evidence row.
  on conflict (provider, provider_event_id) where authenticated do nothing
  returning communication_provider_event_id into v_id;
  if v_id is null then
    return jsonb_build_object('status', 'DUPLICATE');
  end if;
  if not p_authenticated then
    return jsonb_build_object('status', 'UNAUTHENTICATED');
  end if;
  return private.comms_apply_provider_event(v_id);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- F3 (targeted OTP/verify lockout): the TS layer (lib/server/domain/auth/service.ts) now keys the
-- tight bucket on (normalized email, client IP) and additionally consumes a higher, email-only
-- ceiling as a backstop against a distributed attacker. These are new scopes; the original
-- email-only scopes are unchanged in shape (only the subject a caller passes differs).
-- ---------------------------------------------------------------------------------------------
insert into infra.rate_limit_policy (scope, max_hits, window_seconds, subject_kind, description) values
  ('auth.verify.email.global', 30, 600, 'SUPPLIED', 'F3: OTP verify attempts per email regardless of IP (backstop)'),
  ('auth.otp.email.hour.global', 20, 3600, 'SUPPLIED', 'F3: OTP requests per email regardless of IP (backstop)')
on conflict (scope) do nothing;

-- ---------------------------------------------------------------------------------------------
-- F7 (SEC-060): CSP violation reports posted to /api/csp-report, rate-limited per client IP.
-- ---------------------------------------------------------------------------------------------
insert into infra.rate_limit_policy (scope, max_hits, window_seconds, subject_kind, description) values
  ('csp_report.ip', 120, 3600, 'SUPPLIED', 'F7: CSP violation reports accepted per client IP')
on conflict (scope) do nothing;

-- ---------------------------------------------------------------------------------------------
-- F1 (SEC-082): single-use replay guard for solved ALTCHA proof-of-work challenges. The HMAC
-- signature + PoW is verified in TS (lib/server/domain/communications/captcha.ts); this table only
-- proves a given challenge has never been consumed before, so a captured/replayed solved payload
-- can never verify twice. `challenge` is the ALTCHA challenge hash (sha256 hex), effectively
-- unguessable without the HMAC key, so it doubles safely as the replay key.
-- ---------------------------------------------------------------------------------------------
create table private.altcha_replay (
  challenge text primary key check (challenge ~ '^[0-9a-f]{64}$'),
  consumed_at timestamptz not null default now(),
  expires_at timestamptz not null
);
alter table private.altcha_replay enable row level security;
create index altcha_replay_expires_idx on private.altcha_replay (expires_at);

-- SYSTEM only. Returns {consumed:true} the first time a challenge is seen, {consumed:false} on any
-- replay. Also opportunistically prunes expired rows so the table never grows unbounded without
-- needing its own worker/cron entry.
create function private.consume_altcha_challenge(p_challenge text, p_expires_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  if coalesce(p_challenge, '') !~ '^[0-9a-f]{64}$' or p_expires_at is null then
    raise exception using errcode = 'invalid_parameter_value', message = 'invalid altcha challenge';
  end if;

  delete from private.altcha_replay where expires_at < pg_catalog.now() - interval '1 hour';

  insert into private.altcha_replay (challenge, expires_at) values (p_challenge, p_expires_at)
  on conflict (challenge) do nothing;
  get diagnostics v_rows = row_count;
  return jsonb_build_object('consumed', v_rows > 0);
end;
$$;

create function public.consume_altcha_challenge(p_challenge text, p_expires_at timestamptz)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.consume_altcha_challenge(p_challenge, p_expires_at) $$;

revoke all on function
  private.consume_altcha_challenge(text, timestamptz), public.consume_altcha_challenge(text, timestamptz)
from public, anon, authenticated, service_role;

grant execute on function
  private.consume_altcha_challenge(text, timestamptz), public.consume_altcha_challenge(text, timestamptz)
to service_role;
