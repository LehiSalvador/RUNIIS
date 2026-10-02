# Runbook — Vercel cutover and rollback of `runiismty.com`

Status: **prepared, not executed.** Production still serves the Netlify placeholder; V1 is not deployed to Vercel Production.
Decision record: `docs/adr/ADR-002-platform-vercel-supabase-scheduler.md`. Sources: migration readiness
`docs/audits/RUNIIS_NETLIFY_TO_VERCEL_MIGRATION_READINESS_V1.md` sections 10, 22, 23, 24; Phase 1 packet section 4.

No secret value appears here. Variables are named, never valued. Every provider write below is performed by the
orchestrator or the owner and logged secret-free; the scoped Vercel token cannot read or write DNS records, so **DNS
changes are an owner action**. No step authorises billing, an upgrade or a domain renewal payment.

## 1. Preconditions (all must hold; record each as evidence)

1. OWN-01 is recorded as the owner position (V1 processes no payment on the platform) and has not been withdrawn.
   Residual Vercel fair-use risk is re-confirmed before the public opening of paid `EXTERNAL_WHATSAPP` editions (Master `PEND-HOSTING-001`).
2. Phase 1 technical gate PASS on the staging Preview: build, `/api/health` = `staging`, headers/CSP, `robots.txt` noindex,
   client-IP bucket separation and spoof attempt, GPX 4.4 MB / 4.6 MB probe, worker tick on the staging database.
3. Vercel Production environment variables set for `APP_ENV=production`, `APP_BASE_URL` = apex origin, production Supabase
   values, `PASS_CREDENTIAL_ENCRYPTION_KEY_V1` identical to the key the production database data was written with,
   `INTERNAL_CRON_SECRET` unique to production, `EMAIL_DELIVERY_MODE=live`. Variables are verified by metadata only; shared
   Production+Preview entries were narrowed to Production and their provenance re-verified.
4. Vercel domain configuration corrected: apex is primary and `www` redirects to apex with 308 (the project currently has the
   inverse redirect, AUD-010). Decide whether production domains auto-assign to new deployments or the candidate is promoted manually.
5. Supabase Auth (production project): Site URL = apex, redirect allowlist contains the apex `/auth/callback`, OTP length 6.
6. Supabase Vault entries `runiis_worker_base_url` (apex origin) and `runiis_worker_cron_secret` set for production and verified
   by `docs/runbooks/worker-scheduler-vault.md` section 2; `/api/internal/workers/*` is not behind Vercel Deployment Protection.
7. Netlify untouched: published deploy, domain configuration, `force_ssl` and environment variables intact (rollback target).
8. DNS snapshot below re-read against live resolution within 24 h of the change. TTL is 60 s.
9. The Vercel certificate for `runiismty.com` and `*.runiismty.com` is valid on the day of the change (issued 2026-09-24, expires
   2026-12-23, auto-renew).

## 2. DNS snapshot (readiness section 10, observed 2026-10-01; zone on Vercel DNS)

| Record | Value | Cutover action |
| --- | --- | --- |
| `@ A` | `75.2.60.5` (Netlify) | **delete** at cutover; keep this value for rollback |
| `@ ALIAS` | `84d9b449bb5bfe43.vercel-dns-017.com` (system) | preserve; takes the apex once the `A` is gone (verify precedence at the moment of change) |
| `www CNAME` | `runiis-web.netlify.app.` (Netlify) | **delete or repoint to Vercel**; keep this value for rollback |
| `* ALIAS` | `cname.vercel-dns-017.com.` (system) | preserve; serves the `staging.runiismty.com` branch domain and `www` if the `www` CNAME is deleted (verify) |
| `@ TXT` | Brevo verification code | preserve |
| `brevo1._domainkey`, `brevo2._domainkey` CNAME | Brevo DKIM | preserve |
| `_dmarc TXT` | `v=DMARC1; p=none; rua=mailto:rua@dmarc.brevo.com` | preserve |
| `@ CAA` x3 | `letsencrypt.org`, `sectigo.com`, `pki.goog` | preserve |
| SPF / MX | absent | not changed here (REQUIRES_VERIFICATION, readiness section 10) |

## 3. Cutover procedure

1. Record the start time and the Netlify published production deploy (`main@bdd1198`, placeholder) as the rollback target.
2. Confirm the candidate commit has a READY Vercel Production deployment and that `runiismty.com` and `www.runiismty.com` are
   verified on the Vercel project but still resolve to Netlify.
3. Owner deletes `@ A 75.2.60.5`, then deletes or repoints `www CNAME`. Do not touch any other record.
4. Verify resolution against `ns1.vercel-dns.com` and at least two public resolvers: apex and `www` resolve to Vercel;
   `staging.runiismty.com` still resolves to the staging Preview.
5. Smoke on production: `/`, `/api/health` (must report `production`), `/eventos`, `/robots.txt` (indexable), `/sitemap.xml`,
   `www` to apex redirect, response headers (HSTS, CSP, no Netlify HUD injection).
6. Technical validation: email OTP login, Google OAuth callback, pass QR issuance, one scheduler tick of each minute and
   five-minute job visible in `net._http_response` (200) and `cron.job_run_details`, cache invalidation after an edition edit.
   `infra.worker_run` rows for the HTTP workers are `PENDING_VERIFICATION` (ADR-002 D2).
7. Keep Netlify untouched for a bounded window chosen by the owner. Retire Netlify (domain, variables, site, deploy hook) only
   after the owner gives final approval (OPEN-05).

## 4. Rollback triggers

Roll back when any of the following holds after step 3: `/api/health` is not 200 or not `production`; sustained 5xx rate;
OTP or OAuth callback failures; a worker has not run for more than twice its interval; P0 email failure; CSP blocks own
scripts; invalid certificate.

If the failure is in the application and not in the platform or DNS, first promote the last good Vercel Production deployment
(retention is 30 days, 10 kept); whether a one-click rollback exists on the current plan is not verified here and must be checked
at execution time. DNS rollback is for host-level failure.

## 5. Rollback procedure (DNS)

1. Owner recreates `@ A 75.2.60.5` and `www CNAME runiis-web.netlify.app.` (TTL 60). Leave the system `ALIAS` records alone.
2. Pause the scheduler so it stops calling a host that no longer serves the workers: for each job `http-outbox-dispatch`,
   `http-issue-pending-credentials`, `http-communication-reconcile`, `http-provider-usage-reconcile` run
   `cron.alter_job(jobid, active := false)` (Vault runbook section 3). Netlify no longer hosts workers: its Scheduled Functions
   were removed from the repository (`c53c431`) and the published deploy is the placeholder.
3. Do not modify or delete Netlify variables, and **do not rebuild Netlify from `staging`**: the build configuration was
   removed; rollback restores traffic to the already-published deploy only.
4. Verify resolution and `/api/health` on the placeholder, then record the time.
5. State and sessions: the application is stateless and data lives in Supabase (shared by both hosts), so data written during the
   Vercel window stays valid. Session cookies are host-only on the same domain and project and survive. ISR caches of the
   restored host can serve content up to 300 s old.
6. While production serves only the placeholder, the data impact of a rollback is nil.

## 6. Evidence to keep (secret-free)

Before/after resolver output for apex, `www` and `staging`; health response bodies; response headers; scheduler verification
queries without secret values; the time of each step; who performed each DNS write.
