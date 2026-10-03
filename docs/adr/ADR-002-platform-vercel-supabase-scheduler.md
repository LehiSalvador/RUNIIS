---
type: adr
status: accepted
authority: 70
---
# ADR-002 — Platform: Vercel hosting, Supabase scheduler, client IP, environment model, ALTCHA

Status: accepted · 2026-10-01 · Phase 1 `P1-PLATFORM-REBASE` · Amends ADR-001 where marked there.
Functional authority remains `docs/RUNIIS_WEB_SYSTEM_MASTER_SPEC_V2.md` (the Master); this ADR fixes how the
platform layer is realised after the owner closed `TARGET_PRODUCTION_HOSTING = VERCEL` (2026-10-01).

Facts below are stated as implemented in the cited commits. Anything not yet verified on a live Vercel
deployment or a remote Supabase project is marked `PENDING_VERIFICATION` and is not asserted.

## Context

- ADR-001 and the Master (before the Phase 1 patches) selected Netlify as hosting, with Netlify Scheduled Functions
  as the trigger for HTTP workers. The audit (`docs/audits/RUNIIS_MASTER_AUDIT_REPORT_V1.md`) found that no remote
  surface ran V1 code, that no Netlify function had ever been deployed (AUD-038), and that the Vercel project
  `runiis-web` already exists (Hobby team, Git-linked, production branch `main`).
- Vercel Hobby cron is daily at best, so the Netlify trigger design of ADR-001 decision 10 cannot be carried over.
- Anonymous rate limits depended on a Netlify-only header (AUD-004); health and robots did not vary by
  environment (AUD-015, AUD-028); the GPX import envelope exceeded the Vercel request-body limit (AUD-030).
- Two decisions lived only in `.local-state/` (ignored by Git): the ALTCHA CAPTCHA (SEC-082) and the scheduler
  policy. Master audit patch 13 requires them in a versioned ADR.

## Decisions

### D1. Hosting (OPEN-05 scope)

1. Hosting target is **Vercel** (project `runiis-web`, Next.js on the native Vercel runtime, `pnpm run build`).
   No Netlify Next adapter.
2. **Netlify is legacy**: it keeps serving the public placeholder and is the DNS rollback target until a cutover is
   validated. It receives no new product architecture (Roadmap section 18). Its code surface (functions, `netlify.toml`,
   plugin) was removed in `c53c431`. Its site, domain config, environment variables and published deploy are
   untouched and are retired only after a validated cutover and final owner approval (OPEN-05).
3. **OWN-01 (commercial-use terms), recorded as the owner position, not as a legal conclusion.** Owner position
   2026-10-01: V1 processes no payment on the platform; paid registration is only a WhatsApp quote hand-off with human
   confirmation; in-platform payment is V2 (Master section 11). Residual risk, stated neutrally: the Vercel fair-use
   guidelines for the Hobby plan list "requesting or processing payment from visitors". This ADR does not interpret
   those terms. The position is re-confirmed before the public opening of paid `EXTERNAL_WHATSAPP` editions
   (Phase 5; Master `PEND-HOSTING-001`). With that position recorded, OWN-01 does not block preparing or executing a cutover (Phase 1 packet
   section 4); executing it still needs the owner DNS action and the runbook preconditions, and production keeps serving
   the placeholder until it is executed.
4. The production gate verifies plan, terms, capacity and limits on the deployment date (Master section 192);
   if the host stops being suitable, `HostingRuntime` is replaced without changing domain contracts.
5. Domain `runiismty.com` is registered in Vercel with auto-renew off (expires 2027-09-24): Master `PEND-DOMAIN-RENEWAL`
   (OWN-02; renewal implies a payment and is an owner decision).

### D2. Worker scheduler (OPEN-01 closed)

Supabase `pg_cron` + `pg_net` POST to the existing Next worker routes. No Netlify, no Vercel Cron, no second
scheduler. Implemented in migration `supabase/migrations/20260929100000_worker_http_triggers.sql` (commit `a987977`) and
pgTAP `supabase/tests/database/701_worker_http_triggers.test.sql`.

- `private.trigger_worker_http(worker_key)` performs `POST <base>/api/internal/workers/<key>` with
  `Authorization: Bearer <INTERNAL_CRON_SECRET>`, 25 s timeout. The key is checked against a closed allow-list of
  four HTTP workers; the function is revoked from `public`, `anon`, `authenticated` and `service_role`.
- Base URL and secret are read at every run from Supabase Vault named secrets `runiis_worker_base_url` and
  `runiis_worker_cron_secret`, set per environment out of band (runbook `docs/runbooks/worker-scheduler-vault.md`).
  If either entry is absent or blank the trigger does nothing (fail-safe, never a default host).
- Jobs: `http-outbox-dispatch` every minute, `http-issue-pending-credentials` every 5 min,
  `http-communication-reconcile` every 15 min, `http-provider-usage-reconcile` daily 00:05 UTC. `cron.schedule`
  upserts by job name, so the migration is re-runnable. The three DB-only workers (`expire-registration-requests`,
  `close-registration-windows`, `archive-guests`) are unchanged `pg_cron` SQL jobs.
- Duplicate or overlapping triggers are harmless: workers claim with `FOR UPDATE SKIP LOCKED` + lease and de-duplicate by
  effect key. The Netlify functions were never deployed, so no double execution exists.
- Rejected: Vercel Cron (Hobby is daily and imprecise; per-minute is a paid plan), GitHub Actions `schedule` (no punctuality
  guarantee; possible backup only), external cron service (new provider, no decision).
- Local development points the same mechanism at the dev server through `scripts/worker-vault.mjs` (local only).
- Operational constraint: the target deployment must not sit behind Vercel Deployment Protection for
  `/api/internal/workers/*`, or the scheduler would silently never reach the route.

Proof in the cited commits: pgTAP 701 and a local run in which `pg_cron` fired `pg_net` calls that the dev server
answered 200 (valid secret) and 401 (wrong secret).

`PENDING_VERIFICATION`: (a) the HTTP workers did **not** write `infra.worker_run` at `c53c431`; only the three DB cron
workers do (finding recorded in WU-P1-D evidence). ADR-001 decision 10 and Master section 152 intend recording for every
worker, and a change in that direction is in progress outside this ADR. (b) A real tick on a Vercel deployment against
the non-production Supabase project has not been observed.

### D3. Client IP detection

Encapsulated in `lib/server/http/client-ip.ts` (commit `621c1ce`; IMPLEMENTATION_FLEXIBLE per audit 6.3).

- On Vercel (server-side `VERCEL` environment variable, which a client cannot influence) only the edge-overwritten
  `x-vercel-forwarded-for`, `x-real-ip` and `x-forwarded-for` are consulted, in that order, and the Netlify header
  `x-nf-client-connection-ip` is ignored (Vercel does not strip it, so it is client-controlled there).
- Off Vercel (Netlify coexistence, local) behaviour is unchanged: only `x-nf-client-connection-ip` is trusted.
- A value is trusted only if it is a single syntactically valid IP (`net.isIP`); a chain or garbage never mints a new bucket.
  Outside `APP_ENV=local` a missing or invalid value falls into one strict shared `unknown` bucket.
- Unit tests: `tests/unit/server/client-ip.test.ts`.

`PENDING_VERIFICATION`: that the three Vercel headers are actually populated and overwritten on a live Preview, i.e.
two client IPs get distinct buckets and a forged header does not (Phase 1 gate probe, Roadmap section 7.15).

### D4. Environment model and Preview backend (OPEN-02)

Owner model (2026-09-27) mapped to Vercel and Supabase. This supersedes the ADR-001 "Verified context" wording that
bound staging to a Netlify branch deploy.

| Environment | Source | Host | Data | `APP_ENV` | Email |
| --- | --- | --- | --- | --- | --- |
| Local | developer machine | `127.0.0.1:3100` | Supabase Docker | `local` | `capture` + Mailpit |
| Staging | git branch `staging` | Vercel Preview, branch domain `staging.runiismty.com` | remote Supabase `runiis-web-staging` (`brxdgvcfykmsqmhsvgxl`), non-production and **never authoritative** | `staging` | `allowlist` with the owner account address |
| Generic Preview | any other branch or PR | generated URLs behind Vercel Authentication | non-production values only, no production server secrets | `staging` | `capture` |
| Production | git branch `main` | Vercel Production, `runiismty.com` | Supabase `runiis-web-prod` (`mdzhsoeqagtwznybwtuy`), the only authoritative remote, reached through SalvaOps | `production` | `live` |

- Vercel Preview with a branch domain and branch-scoped variables is available on every plan (Hobby included); no
  Custom Environment is used.
- Production database and production server secrets are never used by Preview. Existing shared Vercel variable
  entries (Production + Preview in one entry) are narrowed to Production; their values were never read and their
  provenance is UNKNOWN, so they are re-verified before the V1 production release.
- Email: `EMAIL_DELIVERY_MODE` is `live | allowlist | capture`; unset resolves to `capture` outside production and to
  refuse-to-send in production; `capture` is also refused in production (`lib/server/providers/email/delivery-mode.ts`).
  `EMAIL_ALLOWLIST` is required with `allowlist`. The owner account address is configured in the environment, never in
  documents. In `allowlist` without an explicit `MAILPIT_URL` (a deployed staging has no capture sink) a non-allowlisted
  recipient is never transported: the dispatch claim cancels it terminally (`CANCELED`, `last_error = NOT_ALLOWLISTED`)
  before reserving quota, so it is not retried and does not count against the Brevo daily usage; only allowlisted mail
  reaches Brevo.
- Provider configuration (Vercel environment and domains, Supabase Auth settings, Vault values) is executed by the
  orchestrator and logged secret-free, because SalvaOps typed capabilities do not cover these writes.
- Supabase Auth per environment: Site URL and redirect allowlist must include the host of that environment
  (`https://staging.runiismty.com/**` for staging); see D8 for OTP length.

`PENDING_VERIFICATION`: the Preview backend is blocked until a staging-scoped access binding or credentials exist
(SalvaOps `supabase.*` capabilities are bound to the production project). Migrations, Auth settings and Vault values on
the staging project have not been applied or read back.

### D5. Anonymous reminder CAPTCHA: ALTCHA (SEC-082, M-GAP-04)

Self-hosted proof-of-work CAPTCHA, `altcha-lib` v1; no third-party service and no user data leaves RUNIIS. Implemented in
`lib/server/domain/communications/captcha.ts` and `app/api/v1/reminders/route.ts`.

- `GET /api/v1/reminders/challenge` issues a challenge (HMAC key derived with HKDF-SHA-256 from `INTERNAL_CRON_SECRET`
  under the distinct label `runiis:altcha:reminder:v1`, so no new variable exists and the key is never the cron secret
  itself); TTL 2 minutes; `maxnumber` 100000 to bound client solve time.
- `POST /api/v1/reminders` verifies the solution first and fails closed (VALIDATION_ERROR on `altcha`, no rate-limit
  consumption, nothing enqueued) on a missing, invalid, expired or replayed solution. The challenge is claimed single-use
  in the database (`consume_altcha_challenge`, migration `20260928210000_700_sec_fix_1.sql`). Only then are the per-IP and
  per-email limits consumed. The response is always `accepted: true` (no address oracle).
- Consequence: rotating `INTERNAL_CRON_SECRET` invalidates outstanding challenges (at most 2 minutes of them).
- Parameters (`maxnumber`, TTL) are to be tuned after the frontend widget exists; the widget is a later UI unit.

### D6. GPX import under the Vercel request-body limit (AUD-030)

The official Vercel Functions limit read on 2026-10-01 is a 4.5 MB request body (413 `FUNCTION_PAYLOAD_TOO_LARGE`
before the app runs); the documentation shows no larger figure and none was relied on. Commit `7065f43`:

- decoded GPX cap 5 MB -> **3.25 MB** (`GPX_MAX_DECODED_BYTES = 3_250_000`, SEC-100);
- request-body cap 7.5 MB -> **4.4 MB** (`GPX_MAX_REQUEST_BODY_BYTES = 4_400_000`, `defineRoute maxBodyBytes`);
- worst-case base64 envelope 4_335_384 B fits under 4_500_000 (unit test); oversize yields VALIDATION_ERROR and nothing is truncated.

Rationale: a 5 MB decoded file is impossible on any single-request path because base64 inflates it to about 6.67 MB.
Direct-to-storage upload is a new architecture and is out of scope. Functional impact: files between 3.25 MB and 5 MB that
were accepted before are rejected; a race GPX is typically 0.1-1.5 MB. Detail: WU-P1-C evidence `gpx-limit-decision.md`.

`PENDING_VERIFICATION`: the platform-side probe on a Vercel Preview (about 4.45 MB and the maximum legitimate envelope
must reach the app; about 4.6 MB must be rejected by the platform). If the platform rejects the first two, the caps are
lowered to the observed limit before Phase 1 closes.

### D7. Truthful health and noindex outside production

- `/api/health` reports the real `APP_ENV` (`local | staging | production`) and answers 503 with environment `unknown`
  when it is unset or invalid; it never defaults silently to `staging` (AUD-028).
- `robots.txt`, root and page metadata, and the `X-Robots-Tag` header are noindex whenever `APP_ENV != production`
  (AUD-015). Commit `621c1ce`; tests `tests/unit/health.test.ts`, `tests/unit/public/noindex-environments.test.ts`.

### D8. Auth OTP length

The application accepts only 6-digit email OTP codes (Master section 17). When re-verified on 2026-10-01 both remote
Supabase projects had OTP length 8, which would make remote login fail. The remote setting is aligned to **6** as a provider
operation of Phase 1 (P1-AC-15). `PENDING_VERIFICATION` until read back from each project.

### D9. Netlify decommission

- Code retirement (done, `c53c431`): `netlify/functions/*`, `netlify.toml`, `@netlify/functions`,
  `@netlify/plugin-nextjs`. Replaced by D2. The ADR-001 "Layout" entry `netlify/functions/` is superseded.
- Platform retirement (not done): Netlify site, domain config, environment variables, deploy hook (consumer UNKNOWN) and
  the published placeholder deploy remain as rollback until OPEN-05 closes with owner approval.
- Rollback consequence: because the repository no longer carries Netlify build configuration, rollback restores DNS to the
  already-published Netlify deploy; it never rebuilds Netlify from `staging` (runbook `docs/runbooks/vercel-cutover-and-rollback.md`).

## Alternatives considered

- Vercel Pro for per-minute Cron: a paid plan; no billing without explicit owner action (Roadmap section 17).
- Custom Vercel Environment for staging: requires a paid plan; a Preview branch domain gives the same result.
- Production Supabase for Preview: forbidden by the owner model.
- Per-IP limit keyed on `x-forwarded-for` everywhere: spoofable behind Netlify; rejected in favour of the per-platform trusted header.
- Third-party CAPTCHA: adds a provider and sends user data out; rejected.

## Consequences

- One scheduler (Supabase) serves local, staging and production; each environment needs two Vault entries and an
  `INTERNAL_CRON_SECRET` that differs per environment.
- The platform layer is detected from `VERCEL`; running the app on another host needs a new branch in `client-ip.ts`.
- `INTERNAL_CRON_SECRET` is both the worker Bearer and the ALTCHA key material (different derivation); rotation order is in the Vault runbook.

## Not decided here

OWN-02 domain renewal; OWN-04 to OWN-07; OPEN-03 PostgREST pre-request gateway; OPEN-04 email capacity; OPEN-06
formal state of Gate 0; the production cutover execution (Phase 1 unit G; needs the owner DNS action).

## References

Audit `docs/audits/RUNIIS_MASTER_AUDIT_REPORT_V1.md` (sections 5, 6, 9; AUD-002, 004, 005, 010, 013, 014, 015, 025, 028, 030, 035, 037, 038);
`docs/audits/RUNIIS_NETLIFY_TO_VERCEL_MIGRATION_READINESS_V1.md` (sections 4, 8, 10, 17, 22, 23);
`docs/execution/phase-1/PHASE_1_PACKET.md` (sections 4, 5); Roadmap `docs/RUNIIS_EXECUTION_ROADMAP_V1.md` (7.4-7.15, 15-18);
threat model `docs/specs/T11-appsec-threat-model.md` (SEC-082, SEC-141); commits `621c1ce`, `7065f43`, `a987977`, `c53c431`.
