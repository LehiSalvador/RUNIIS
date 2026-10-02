# Runbook — Worker scheduler Vault configuration (per remote environment)

Provenance: promoted from `.salvaops-agent-evidence/WU-P1-D-worker-scheduler/vault-runbook.md` (WU-P1-D, commit `c53c431`) by
WU-P1-B-authority-docs on 2026-10-01; everything below the marker is that runbook verbatim. Decision record:
`docs/adr/ADR-002-platform-vercel-supabase-scheduler.md` (D2). The rotation order and disable switch are also used by
`docs/runbooks/vercel-cutover-and-rollback.md`.

<!-- BEGIN VERBATIM SOURCE -->
# Vault runbook: HTTP worker scheduler (per remote environment)

Applies to Supabase staging (`brxdgvcfykmsqmhsvgxl`) and production (`mdzhsoeqagtwznybwtuy`), run by the orchestrator
only, after migration `20260929100000_worker_http_triggers.sql` is applied there. Placeholders in angle brackets;
never paste real values into a committed file, ticket or chat. Run through a channel that does not log statements
(Supabase SQL editor or the Management API query endpoint with the body kept out of shell history).

## Prerequisites per environment

- The app deployment for that environment has `INTERNAL_CRON_SECRET` set (>= 32 random chars, unique per environment).
- `<APP_BASE_URL>` is the public origin of that same deployment: `scheme://host[:port]`, no path, no trailing path
  segment (trailing slashes are trimmed). Staging: the `staging.runiismty.com` Vercel origin. Production: the production
  origin. Preview/staging and production must never share the secret.
- The Vercel deployment must not be behind Deployment Protection for `/api/internal/workers/*`
  (a protected URL answers 401/403 before reaching the route, so the scheduler would silently never run).

## 1. Set or rotate (idempotent: creates, or updates in place)

```sql
do $$
declare v_id uuid;
begin
  select id into v_id from vault.secrets where name = 'runiis_worker_base_url' order by updated_at desc limit 1;
  if v_id is null then
    perform vault.create_secret('<APP_BASE_URL>', 'runiis_worker_base_url', 'RUNIIS worker scheduler: base URL of this environment');
  else
    perform vault.update_secret(v_id, '<APP_BASE_URL>', 'runiis_worker_base_url', 'RUNIIS worker scheduler: base URL of this environment');
  end if;

  select id into v_id from vault.secrets where name = 'runiis_worker_cron_secret' order by updated_at desc limit 1;
  if v_id is null then
    perform vault.create_secret('<INTERNAL_CRON_SECRET>', 'runiis_worker_cron_secret', 'RUNIIS worker scheduler: INTERNAL_CRON_SECRET of this environment');
  else
    perform vault.update_secret(v_id, '<INTERNAL_CRON_SECRET>', 'runiis_worker_cron_secret', 'RUNIIS worker scheduler: INTERNAL_CRON_SECRET of this environment');
  end if;
end $$;
```

The functions read the secrets at every run, so a change takes effect on the next tick (no restart).

Rotation order: set the new `INTERNAL_CRON_SECRET` in the Vercel environment and redeploy, then run the SQL above
with the same value. Between the two steps scheduled calls return 401 (harmless: workers are idempotent and the
next tick succeeds); to avoid even that, run the SQL immediately after the deployment is live.

## 2. Verify (no values shown)

```sql
select name, length(decrypted_secret) as value_length,
       case when name = 'runiis_worker_base_url' then decrypted_secret else '<redacted>' end as shown
from vault.decrypted_secrets where name in ('runiis_worker_base_url', 'runiis_worker_cron_secret') order by name;

select jobname, schedule, active from cron.job where jobname like 'http-%' order by jobname;
```

Expect two rows (non-zero lengths) and four active jobs: `* * * * *`, `*/5 * * * *`, `*/15 * * * *`, `5 0 * * *`.

After one minute, confirm the minute job reached the deployment:

```sql
select r.status_code, r.timed_out, left(r.error_msg, 80) as error, left(r.content, 160) as body
from net._http_response r order by r.id desc limit 5;
```

`200` with `{"data":{...},"meta":{"worker":"outbox-dispatch"}}` is healthy. `401` means the Vault secret differs from the
deployment's `INTERNAL_CRON_SECRET`; `404/403` with HTML means a wrong base URL or Deployment Protection; a non-null
`error` or `timed_out = true` means the host is unreachable or slower than the 25 s timeout.
`net._http_response` is pruned automatically (about 6 h) and `cron.job_run_details` records every tick.

## 3. Disable (kill switch for one environment)

Either clear the entries (the jobs keep running and do nothing):

```sql
delete from vault.secrets where name in ('runiis_worker_base_url', 'runiis_worker_cron_secret');
```

or pause a single worker without touching Vault:

```sql
select cron.alter_job((select jobid from cron.job where jobname = 'http-outbox-dispatch'), active := false);
-- resume: active := true
```

## Notes

- Do not set these entries on a database that should not call a deployment (e.g. local dev uses
  `node scripts/worker-vault.mjs set`, which points at `http://host.docker.internal:3100`).
- The two names are a contract with `private.trigger_worker_http`; renaming them requires a new migration.
- pg_cron runs jobs as the migration owner (`postgres`); the Vault entries are only readable by that role and by
  `service_role` through `vault.decrypted_secrets`. Do not grant the view to `anon`/`authenticated`.
