-- Phase 1 (WU-P1-D2): let the pg_cron/pg_net worker trigger reach a Vercel deployment that sits behind
-- Vercel Authentication (e.g. the staging Preview). Vercel "Protection Bypass for Automation" accepts the
-- bypass secret in the `x-vercel-protection-bypass` request header.
--
-- Behaviour change versus 20260929100000_worker_http_triggers.sql (which stays immutable):
--   * an OPTIONAL Vault entry `runiis_vercel_protection_bypass` is read at run time;
--   * when it exists and is not blank, the request carries exactly one extra header
--     x-vercel-protection-bypass: <value>;
--   * when it is absent or blank the request is identical to the previous version (same URL, method,
--     Content-Type, Authorization, 25 s timeout, same fail-safe no-op rules).
-- The value is never logged, returned or embedded in cron.job.command; the job commands are unchanged.

create or replace function private.trigger_worker_http(p_worker_key text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base text;
  v_secret text;
  v_bypass text;
  v_headers jsonb;
  v_request_id bigint;
begin
  -- Closed allow-list: only the four registered HTTP workers can be triggered from the database.
  if p_worker_key is null
     or p_worker_key not in ('outbox-dispatch', 'issue-pending-credentials', 'communication-reconcile', 'provider-usage-reconcile') then
    raise exception using errcode = 'invalid_parameter_value', message = 'unknown http worker key';
  end if;

  select s.decrypted_secret into v_base
  from vault.decrypted_secrets s where s.name = 'runiis_worker_base_url'
  order by s.updated_at desc limit 1;
  select s.decrypted_secret into v_secret
  from vault.decrypted_secrets s where s.name = 'runiis_worker_cron_secret'
  order by s.updated_at desc limit 1;
  select s.decrypted_secret into v_bypass
  from vault.decrypted_secrets s where s.name = 'runiis_vercel_protection_bypass'
  order by s.updated_at desc limit 1;

  v_base := pg_catalog.btrim(coalesce(v_base, ''));
  v_secret := pg_catalog.btrim(coalesce(v_secret, ''));
  v_bypass := pg_catalog.btrim(coalesce(v_bypass, ''));
  -- Unconfigured environment: do nothing, never fall back to a default host. The bypass entry is optional
  -- and never decides whether a request is sent.
  if v_base = '' or v_secret = '' then
    return null;
  end if;

  v_base := pg_catalog.regexp_replace(v_base, '/+$', '');
  if v_base !~* '^https?://[^/[:space:]]+$' then
    raise exception using errcode = 'invalid_parameter_value', message = 'runiis_worker_base_url must be scheme://host[:port] with no path';
  end if;

  v_headers := pg_catalog.jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret);
  if v_bypass <> '' then
    v_headers := v_headers || pg_catalog.jsonb_build_object('x-vercel-protection-bypass', v_bypass);
  end if;

  -- Same shape as before: POST, Bearer header, 25 s timeout, no body of significance.
  select net.http_post(
    url := v_base || '/api/internal/workers/' || p_worker_key,
    body := '{}'::jsonb,
    headers := v_headers,
    timeout_milliseconds := 25000
  ) into v_request_id;
  return v_request_id;
end;
$$;

-- create or replace keeps the owner and ACL, but state the closed ACL explicitly (idempotent).
revoke all on function private.trigger_worker_http(text) from public, anon, authenticated, service_role;
