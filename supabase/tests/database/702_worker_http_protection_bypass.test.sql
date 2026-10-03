-- WU-P1-D2: optional x-vercel-protection-bypass header on the pg_cron/pg_net worker trigger. One rolled-back
-- transaction; net.http_post enqueues inside the caller's transaction so the request shape is asserted
-- without network traffic. Every Vault value below is an obviously fake test value.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(16);

delete from vault.secrets where name in ('runiis_worker_base_url', 'runiis_worker_cron_secret', 'runiis_vercel_protection_bypass');
do $$ begin perform vault.create_secret('http://worker.test:3100', 'runiis_worker_base_url'); end $$;
do $$ begin perform vault.create_secret('test-only-cron-secret', 'runiis_worker_cron_secret'); end $$;

-- ---------------------------------------------------------------------------------------------
-- Entry absent: request identical to the pre-bypass shape.
-- ---------------------------------------------------------------------------------------------
create temp table r_absent as select private.trigger_worker_http('outbox-dispatch') as id;
select isnt((select id from r_absent), null::bigint, 'absent entry: the trigger still enqueues a request');
select is((select url from net.http_request_queue where id = (select id from r_absent)),
  'http://worker.test:3100/api/internal/workers/outbox-dispatch', 'absent entry: URL unchanged');
select is((select method from net.http_request_queue where id = (select id from r_absent)), 'POST', 'absent entry: method unchanged');
select is((select timeout_milliseconds from net.http_request_queue where id = (select id from r_absent)), 25000, 'absent entry: timeout unchanged');
select is((select headers from net.http_request_queue where id = (select id from r_absent)),
  '{"Content-Type": "application/json", "Authorization": "Bearer test-only-cron-secret"}'::jsonb,
  'absent entry: headers are exactly Content-Type and Authorization');
select is((select headers ? 'x-vercel-protection-bypass' from net.http_request_queue where id = (select id from r_absent)), false,
  'absent entry: no x-vercel-protection-bypass header');

-- ---------------------------------------------------------------------------------------------
-- Entry blank: same as absent.
-- ---------------------------------------------------------------------------------------------
do $$ begin perform vault.create_secret('   ', 'runiis_vercel_protection_bypass'); end $$;
create temp table r_blank as select private.trigger_worker_http('outbox-dispatch') as id;
select is((select headers from net.http_request_queue where id = (select id from r_blank)),
  (select headers from net.http_request_queue where id = (select id from r_absent)),
  'blank entry: headers identical to the absent-entry request');
select is((select headers ? 'x-vercel-protection-bypass' from net.http_request_queue where id = (select id from r_blank)), false,
  'blank entry: no x-vercel-protection-bypass header');
delete from vault.secrets where name = 'runiis_vercel_protection_bypass';

-- ---------------------------------------------------------------------------------------------
-- Entry present: exactly one extra header, everything else unchanged.
-- ---------------------------------------------------------------------------------------------
do $$ begin perform vault.create_secret('  test-only-bypass-value  ', 'runiis_vercel_protection_bypass'); end $$;
create temp table r_set as select private.trigger_worker_http('outbox-dispatch') as id;
select isnt((select id from r_set), null::bigint, 'present entry: the trigger enqueues a request');
select is((select headers ->> 'x-vercel-protection-bypass' from net.http_request_queue where id = (select id from r_set)),
  'test-only-bypass-value', 'present entry: x-vercel-protection-bypass carries the (trimmed) Vault value');
select is((select headers from net.http_request_queue where id = (select id from r_set)),
  '{"Content-Type": "application/json", "Authorization": "Bearer test-only-cron-secret", "x-vercel-protection-bypass": "test-only-bypass-value"}'::jsonb,
  'present entry: exactly three headers, Authorization and Content-Type unchanged');
select is((select url || '|' || method || '|' || timeout_milliseconds::text from net.http_request_queue where id = (select id from r_set)),
  (select url || '|' || method || '|' || timeout_milliseconds::text from net.http_request_queue where id = (select id from r_absent)),
  'present entry: URL, method and timeout identical to the absent-entry request');

-- ---------------------------------------------------------------------------------------------
-- The bypass entry is optional: it never turns an unconfigured environment into a sender, and the
-- secret is not exposed through the job commands or the trigger's privileges.
-- ---------------------------------------------------------------------------------------------
delete from vault.secrets where name in ('runiis_worker_base_url', 'runiis_worker_cron_secret');
create temp table q1 as select count(*) as n from net.http_request_queue;
select is(private.trigger_worker_http('outbox-dispatch'), null::bigint, 'bypass entry alone: still a no-op without base URL and Bearer secret');
select is((select count(*) from net.http_request_queue), (select n from q1), 'bypass entry alone: nothing enqueued');
select is((select count(*)::int from cron.job where jobname like 'http-%' and command ~* '(bypass|test-only)'), 0,
  'no http job command mentions the bypass entry or its value');
select is(has_function_privilege('service_role', 'private.trigger_worker_http(text)', 'execute')
       or has_function_privilege('authenticated', 'private.trigger_worker_http(text)', 'execute')
       or has_function_privilege('anon', 'private.trigger_worker_http(text)', 'execute'), false,
  'the replaced function is still not executable by anon, authenticated or service_role');

select * from finish();
rollback;
