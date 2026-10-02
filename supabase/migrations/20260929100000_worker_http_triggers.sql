-- Phase 1 (WU-P1-D): provider-independent scheduler for the four HTTP workers (ADR-001 decision 10,
-- Phase 1 Packet decision 1). Supabase pg_cron + pg_net POST to the existing Next worker routes
--   POST <base url>/api/internal/workers/<key>     Authorization: Bearer <INTERNAL_CRON_SECRET>
-- replacing the Netlify Scheduled Functions that were never deployed (AUD-038).
--
-- Nothing environment-specific lives here. The base URL and the Bearer secret are read at run time from
-- Supabase Vault named secrets that the operator sets per environment out of band:
--   runiis_worker_base_url    e.g. https://staging.example (scheme + host[:port], no path)
--   runiis_worker_cron_secret the same value as the app's INTERNAL_CRON_SECRET for that environment
-- Fail-safe: when either entry is absent or blank, a trigger does nothing (no request, no error).
-- Overlapping or duplicate triggers are harmless: the workers claim rows with FOR UPDATE SKIP LOCKED and
-- a lease (claim_outbox_events / claim_communication_messages) and de-duplicate by effect key.

create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault;

create function private.trigger_worker_http(p_worker_key text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base text;
  v_secret text;
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

  v_base := pg_catalog.btrim(coalesce(v_base, ''));
  v_secret := pg_catalog.btrim(coalesce(v_secret, ''));
  -- Unconfigured environment: do nothing, never fall back to a default host.
  if v_base = '' or v_secret = '' then
    return null;
  end if;

  v_base := pg_catalog.regexp_replace(v_base, '/+$', '');
  if v_base !~* '^https?://[^/[:space:]]+$' then
    raise exception using errcode = 'invalid_parameter_value', message = 'runiis_worker_base_url must be scheme://host[:port] with no path';
  end if;

  -- Same shape as the retired Netlify trigger: POST, Bearer header, 25 s timeout, no body of significance.
  select net.http_post(
    url := v_base || '/api/internal/workers/' || p_worker_key,
    body := '{}'::jsonb,
    headers := pg_catalog.jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret),
    timeout_milliseconds := 25000
  ) into v_request_id;
  return v_request_id;
end;
$$;

revoke all on function private.trigger_worker_http(text) from public, anon, authenticated, service_role;

-- cron.schedule upserts by job name, so this migration is re-runnable. Frequencies are the ones of the
-- retired Netlify functions: 1 min / 5 min / 15 min / daily 00:05 UTC.
select cron.schedule('http-outbox-dispatch', '* * * * *', $$select private.trigger_worker_http('outbox-dispatch')$$);
select cron.schedule('http-issue-pending-credentials', '*/5 * * * *', $$select private.trigger_worker_http('issue-pending-credentials')$$);
select cron.schedule('http-communication-reconcile', '*/15 * * * *', $$select private.trigger_worker_http('communication-reconcile')$$);
select cron.schedule('http-provider-usage-reconcile', '5 0 * * *', $$select private.trigger_worker_http('provider-usage-reconcile')$$);
