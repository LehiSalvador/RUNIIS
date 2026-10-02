-- WU-P1-D: pg_cron + pg_net triggers for the four HTTP workers. Everything runs in one rolled-back
-- transaction. net.http_post enqueues into net.http_request_queue inside the caller's transaction, so
-- the request shape is asserted without any network traffic. Vault values below are test-only.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(26);

create function pg_temp.errcode_of(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlstate;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Schedule: four jobs at the retired Netlify frequencies, no URL or secret in any command.
-- ---------------------------------------------------------------------------------------------
select is((select schedule from cron.job where jobname = 'http-outbox-dispatch'), '* * * * *', 'outbox-dispatch runs every minute');
select is((select schedule from cron.job where jobname = 'http-issue-pending-credentials'), '*/5 * * * *', 'issue-pending-credentials runs every 5 minutes');
select is((select schedule from cron.job where jobname = 'http-communication-reconcile'), '*/15 * * * *', 'communication-reconcile runs every 15 minutes');
select is((select schedule from cron.job where jobname = 'http-provider-usage-reconcile'), '5 0 * * *', 'provider-usage-reconcile runs daily at 00:05 UTC');
select is((select command from cron.job where jobname = 'http-outbox-dispatch'),
  $$select private.trigger_worker_http('outbox-dispatch')$$, 'the job command only names the worker key');
select is((select count(*)::int from cron.job where command ~* '(https?://|bearer|secret)' and jobname like 'http-%'), 0,
  'no job command embeds a URL, a Bearer token or a secret');
select is((select count(*)::int from cron.job where jobname in ('close-registration-windows', 'expire-registration-requests', 'archive-guests')), 3,
  'the three DB-only cron jobs are untouched');
select is((select count(*)::int from cron.job where jobname like 'http-%'), 4, 'exactly four HTTP trigger jobs exist');

-- Re-scheduling is an upsert by name (the migration is re-runnable).
do $$ begin perform cron.schedule('http-outbox-dispatch', '* * * * *', $q$select private.trigger_worker_http('outbox-dispatch')$q$); end $$;
select is((select count(*)::int from cron.job where jobname = 'http-outbox-dispatch'), 1, 're-scheduling by name does not duplicate the job');

-- ---------------------------------------------------------------------------------------------
-- Privileges: nobody but the owner (and therefore pg_cron) can fire a trigger.
-- ---------------------------------------------------------------------------------------------
select is(has_function_privilege('anon', 'private.trigger_worker_http(text)', 'execute'), false, 'anon cannot execute the trigger');
select is(has_function_privilege('authenticated', 'private.trigger_worker_http(text)', 'execute'), false, 'authenticated cannot execute the trigger');
select is(has_function_privilege('service_role', 'private.trigger_worker_http(text)', 'execute'), false, 'service_role cannot execute the trigger');

-- ---------------------------------------------------------------------------------------------
-- Unconfigured Vault => no-op (no request, no error).
-- ---------------------------------------------------------------------------------------------
delete from vault.secrets where name in ('runiis_worker_base_url', 'runiis_worker_cron_secret');
create temp table q0 as select count(*) as n from net.http_request_queue;

select is(private.trigger_worker_http('outbox-dispatch'), null::bigint, 'no Vault entries: the trigger returns null');
select is((select count(*) from net.http_request_queue), (select n from q0), 'no Vault entries: no request was enqueued');

do $$ begin perform vault.create_secret('http://worker.test:3100', 'runiis_worker_base_url'); end $$;
select is(private.trigger_worker_http('outbox-dispatch'), null::bigint, 'only the base URL set: no-op');
delete from vault.secrets where name = 'runiis_worker_base_url';

do $$ begin perform vault.create_secret('test-only-cron-secret', 'runiis_worker_cron_secret'); end $$;
select is(private.trigger_worker_http('outbox-dispatch'), null::bigint, 'only the secret set: no-op');
delete from vault.secrets where name = 'runiis_worker_cron_secret';

do $$ begin perform vault.create_secret('   ', 'runiis_worker_base_url'); end $$;
do $$ begin perform vault.create_secret('test-only-cron-secret', 'runiis_worker_cron_secret'); end $$;
select is(private.trigger_worker_http('outbox-dispatch'), null::bigint, 'blank base URL: no-op');
select is((select count(*) from net.http_request_queue), (select n from q0), 'partial or blank configuration never enqueued a request');
delete from vault.secrets where name in ('runiis_worker_base_url', 'runiis_worker_cron_secret');

-- ---------------------------------------------------------------------------------------------
-- Configured Vault => one POST to <base>/api/internal/workers/<key> with the Bearer header.
-- ---------------------------------------------------------------------------------------------
do $$ begin perform vault.create_secret('http://worker.test:3100/', 'runiis_worker_base_url'); end $$;
do $$ begin perform vault.create_secret('test-only-cron-secret', 'runiis_worker_cron_secret'); end $$;

create temp table req as select private.trigger_worker_http('provider-usage-reconcile') as id;
select isnt((select id from req), null::bigint, 'configured: the trigger returns the pg_net request id');
select is((select url from net.http_request_queue where id = (select id from req)),
  'http://worker.test:3100/api/internal/workers/provider-usage-reconcile', 'configured: URL is base (trailing slash trimmed) + worker route');
select is((select method from net.http_request_queue where id = (select id from req)), 'POST', 'configured: method is POST');
select is((select headers ->> 'Authorization' from net.http_request_queue where id = (select id from req)),
  'Bearer test-only-cron-secret', 'configured: Authorization carries the Vault secret as a Bearer token');
select is((select timeout_milliseconds from net.http_request_queue where id = (select id from req)), 25000, 'configured: 25 s timeout, as the retired trigger');

-- ---------------------------------------------------------------------------------------------
-- Closed allow-list and URL shape.
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.errcode_of($$ select private.trigger_worker_http('close-registration-windows') $$), '22023', 'a DB-only worker key is rejected');
select is(pg_temp.errcode_of($$ select private.trigger_worker_http(null) $$), '22023', 'a null worker key is rejected');
delete from vault.secrets where name = 'runiis_worker_base_url';
do $$ begin perform vault.create_secret('https://host.test/some/path', 'runiis_worker_base_url'); end $$;
select is(pg_temp.errcode_of($$ select private.trigger_worker_http('outbox-dispatch') $$), '22023', 'a base URL with a path is rejected, not silently used');

select * from finish();
rollback;
