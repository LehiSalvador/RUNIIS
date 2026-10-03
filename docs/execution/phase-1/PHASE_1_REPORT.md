# RUNIIS WEB — Phase 1 Report

No secret values appear in this report. Variables are named, never valued. This is the single authoritative Phase 1 state; it supersedes every earlier revision of this file.

| Field | Value |
| --- | --- |
| phase_id | `P1-PLATFORM-REBASE` |
| phase_name | Platform Rebase, Vercel Migration & Authoritative Baseline |
| status | `TECHNICAL_PASS_WITH_OWNER_BLOCKER` — the only open owner item is the production cutover, which is out of this close; not `PHASE_APPROVED` (only the owner approves) |
| report_date | 2026-10-02 (America/Monterrey) / 2026-10-03 UTC |
| baseline_in | `staging@a9ef303` (audited) + untracked T41 WIP |
| baseline_out | `staging` = `origin/staging` (this report's commit, see `git log -1 origin/staging`); last integrated code/docs commit before the report: `59f6bc2`; `origin/wip/t41-closure-partial@b34aa74`; `main`/`origin/main@bdd1198` (placeholder, untouched) |
| review URL | https://staging.runiismty.com (sign in to Vercel with the team account when prompted) |

## 1. Observable outcome

- The real RUNIIS V1 build runs on Vercel Preview at `staging.runiismty.com`, backed by the non-production Supabase project `brxdgvcfykmsqmhsvgxl`. It is no longer the placeholder.
- All Phase 1 work is published: local `staging` equals `origin/staging`; GitHub Actions CI runs on every push and passed on its first run.
- `/api/health` reports `staging`; every page is `noindex` and `robots.txt` disallows all; public and nonce CSP, HSTS and the other security headers are served by the real host.
- Email OTP sign-in works end to end on staging (6 digits, Secure/HttpOnly cookie, onboarding reachable); Google sign-in uses the staging OAuth client.
- Anonymous rate limits key on the real client IP behind Vercel; forged forwarding headers do not create buckets.
- The HTTP workers run on Supabase `pg_cron` + `pg_net` against Vercel and record `infra.worker_run`; Netlify scheduling is gone from the code.
- GPX import fits the measured Vercel request-body limit (4.5 MB).
- Netlify remains only as the legacy placeholder and rollback for `runiismty.com`.

## 2. Work Units

| WU | Owner | Result | Commits / evidence |
| --- | --- | --- | --- |
| WU-P1-A baseline | orchestrator | COMPLETE | `afcf1cf` (audits + Roadmap versioned); T41 isolated on `wip/t41-closure-partial@b34aa74` (hashes verified, published, unmerged); offline Git bundle kept by the owner |
| WU-P1-C runtime compatibility | salvaops-backend | PASS | `621c1ce`, `7065f43` |
| WU-P1-D worker scheduler | salvaops-database | PASS (worker_run gap remediated in F) | `a987977`, `c53c431` |
| WU-P1-B authority docs | salvaops-web-architect | PASS | `e17dc16`, `0b03932`, `73e0944`, `9b39693` (+ `f72a132`) |
| WU-P1-F CI + worker runs | salvaops-backend | PASS | `f58634a`, `11daa37`, `0886e6c`, `4959056`, `466d980`, `410bc07`, `aed5a27` |
| WU-P1-D2 bypass header | salvaops-database | PASS | `79b77b9` |
| WU-P1-D3 pg_net privileges | salvaops-database | BLOCKED → risk accepted | net objects owned by `supabase_admin`; runbook assertion `fb24ec8` |
| WU-P1-E provider operations | orchestrator | COMPLETE | `.local-state/phase-1/provider-ops.log` (secret-free) |
| WU-P1-H1 QA gate | salvaops-qa | PASS | Tier 2 on `79b77b9`; all assigned acceptance IDs PASS |
| WU-P1-H2 AppSec gate | salvaops-appsec | PASS_WITH_FINDINGS | revision 3 on `59f6bc2`; no open critical/high |
| WU-P1-H3 Integration & Evidence | salvaops-integration-evidence | re-run on this report's commit | `.salvaops-agent-evidence/WU-P1-H3-integration-evidence/reconciliation.md` |
| WU-P1-G cutover | orchestrator | DEFERRED | section 6 |

Agents used: salvaops-backend ×2, salvaops-database ×3, salvaops-web-architect, salvaops-qa, salvaops-appsec, salvaops-integration-evidence; at most two concurrent model actors.

## 3. Provider and infrastructure state

| Provider | State | Rollback |
| --- | --- | --- |
| GitHub | Public repository (OWN-03). Ruleset `24351949` active on `main`, `staging`, `wip/t41-closure-partial` (deletion and non-fast-forward blocked, no bypass). `origin/staging` fast-forwarded `89b79d4 → 466d980 → 59f6bc2` and then this report; no force push, no history rewrite. | Delete ruleset; refs are additive |
| GitHub Actions | Workflow `CI` (`.github/workflows/ci.yml`); first run `37093761807` on `59f6bc2` = **success**: Lint, Typecheck, Unit tests, pgTAP (34 files / 1049 tests), Integration (Supabase local + dev server), Build, Secret scan (gitleaks). Read-only token, no repository secrets. | — |
| Vercel `runiis-web` | Production = `main@bdd1198` placeholder (unchanged). Preview `staging` = `59f6bc2` deployment `dpl_3o1sf99PBFsgupt6Bp5NDLzge46z` READY, aliased to `staging.runiismty.com`. Env: 24 legacy entries scoped to Production; Production `APP_ENV`, `APP_BASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `INTERNAL_CRON_SECRET`, `PASS_CREDENTIAL_ENCRYPTION_KEY_V1` from the owner source; Preview holds staging-only values for every server variable with `EMAIL_DELIVERY_MODE=capture`; branch `staging` adds `allowlist` (owner address) and Brevo. Domains: apex primary, `www → apex 308`, `staging.runiismty.com` bound to branch `staging`. Vercel Authentication on Preview; Protection Bypass for Automation (secret only in the staging Vault). | Revoke bypass; env/domain snapshot in the checkpoint |
| Supabase staging `brxdgvcfykmsqmhsvgxl` | 68/68 migrations (last `20261002100000`; no T41, no seed, no production data); 82 `app` tables with RLS; Auth site URL staging, OTP 6 digits / 600 s, `before_user_created` hook on; Vault: worker base URL, worker cron secret, Vercel bypass; 7 cron jobs active. QA fixture user retained (non-production). | Pre-migration schema dump and auth snapshot in `.local-state/phase-1/` |
| Supabase production `mdzhsoeqagtwznybwtuy` | No schema change. Auth OTP 6/600 s and allowlist `https://runiismty.com/**` (set 2026-10-02 before the guard). `ALLOW_PRODUCTION_MUTATIONS=false` respected since. | Auth snapshot |
| Supabase access token | `SUPABASE_PAT_CURRENT = VERIFIED` (authenticates; production project only; staging work uses the staging DB credential and staging secret key). `SUPABASE_PAT_PREVIOUS = REVOKED_BY_OWNER` (former full-access token now 401). | — |
| Brevo | Unchanged; free plan; domain authenticated; Authorized-IP blocking disabled for API and SMTP. | — |
| Netlify | Unchanged; production placeholder, env and domain kept as rollback; no Netlify architecture in the code. | — |
| DNS | Unchanged; `runiismty.com` and `www` resolve to Netlify. | — |

Secrets: the only authorized sources are the orchestrator's private file and the agents' provider file; all earlier credential files are retired. No value is recorded in Git, docs, evidence, checkpoint or logs (gitleaks all refs + tree: no leaks; value scan of the tracked tree, docs and evidence: 0 hits).

## 4. Tests and remote verification

- Local Tier 2 (QA, `79b77b9`): install frozen, lint, typecheck, unit 510/510, pgTAP 1049/1049, integration 62/62, build, gitleaks — PASS. Later commits are docs/CI only plus migration `20261002100000`, whose pgTAP 702 is included in the 1049 and in CI.
- Remote CI (GitHub, `59f6bc2`): all 7 jobs success (section 3).
- Remote probes (orchestrator; `.salvaops-agent-evidence/P1-GATE/gate-probes.log`):

| Check | Result |
| --- | --- |
| Deployment | `staging.runiismty.com` → `dpl_3o1sf99…` READY for `59f6bc2` |
| Routes | `/`, `/eventos`, `/entrar`, `/cuenta`, `/runiis`, `/contacto`, `/legal/*`, sitemap → 200 real pages; `/inscripcion`, `/admin`, `/scanner` → controlled 404 (future phases) |
| Health / indexing | `{"environment":"staging"}`; `X-Robots-Tag: noindex, nofollow`; `robots.txt` = `Disallow: /` |
| Headers | public CSP on cached pages; nonce + `strict-dynamic` on private pages; HSTS preload; nosniff; `DENY`; `no-referrer` on `/auth/callback`; `camera=(self)` only on `/scanner` |
| Auth | 6-digit OTP → 200 with Secure/HttpOnly/SameSite session → authenticated session → `/onboarding`; Google redirect chain uses the staging client, no `redirect_uri_mismatch` |
| Client IP / rate limit | 11th wrong code → 429; forged XFF/X-Real-IP/x-vercel-forwarded-for → 429; same email from Supabase egress → 400 (separate bucket) |
| GPX | 4.33 MB and 4.45 MB reach the app; 4.6 MB and 7.5 MB → platform 413 `FUNCTION_PAYLOAD_TOO_LARGE` |
| Workers | pg_cron → pg_net → Vercel: the four HTTP workers and the 5-minute DB workers `SUCCEEDED` in `infra.worker_run`, again after the `59f6bc2` redeploy; 0 stale RUNNING; wrong/absent Bearer → 401 without a run |
| Exposure | without credentials, staging and worker routes return the Vercel SSO redirect; PostgREST rejects `net`, `vault`, `app`, `private`, `cron` (406); GraphQL disabled |
| Email safety | branch `staging` `allowlist`; other previews `capture`; Production has no mode → refuses to send |

Not run: E2E (out of the Phase 1 gate; Phase 2 revalidates the participant journeys on Vercel), real email delivery.

## 5. Findings

Closed: AUD-002, AUD-003, AUD-004, AUD-005, AUD-010, AUD-014, AUD-015, AUD-016 (CI runs and passes), AUD-021, AUD-023, AUD-025, AUD-028, AUD-030, AUD-038; P1-F-01 (remote OTP 8 → 6), P1-F-05 (HTTP workers record `infra.worker_run`); SEC-INC-01 / H2-01 (exposed Supabase PAT replaced; previous tokens revoked by the owner); H2-02, H2-10; staging publication and CI publication.

Open (none critical or high):

| ID | Severity | Owner | Summary |
| --- | --- | --- | --- |
| H2-12 | low (accepted) | orchestrator / salvaops-database | pg_net default grants for anon/authenticated cannot be revoked by project roles; accepted with the verified compensating control (schemas not exposed, GraphQL off) and the runbook assertion |
| H2-03..H2-09 | low | various | project-wide bypass secret (rotate on need); staging Brevo key from the single Brevo account; worker base URL accepts http/any host (needs Vault write); staging redirect wildcard covers the team's preview URLs; remote Auth abuse controls not evidenced; CI actions pinned to major tags; client-IP residuals (Netlify header off Vercel, IPv6 /64). Triage before Phase 5 |
| H2-11 | info | orchestrator | QA fixture user in staging; no `worker_run` retention; ALTCHA key shares the cron secret; generic previews share the staging service key |
| P1-F-08 | info | — | Vercel Authentication also protects the branch-bound staging domain; the owner views after Vercel login, machines use the automation bypass |
| P1-F-10 | low | SalvaOps | `salvaops git push --branch` captures the current HEAD, not the named branch |
| P1-F-11 | low | owner | the Production deployment predates `APP_ENV=production` (health reports `staging`); redeploy deferred by the production guard |
| P1-F-13 | low | owner | the orchestrator's GitHub token lacks the Workflows permission; the publication used the owner's authenticated `gh` CLI session, which has it. Future workflow edits need one of the two |
| AUD-033 | low | frontend (Phase 2) | anonymous `/cuenta` streams 200 under `loading.tsx` before redirecting |

## 6. Owner decisions and the remaining blocker

| Item | State |
| --- | --- |
| OWN-03 | RESOLVED: repository public and published |
| OWN-01 | Owner position: V1 processes no payment on the platform (WhatsApp quote only); residual Vercel fair-use risk to re-confirm before the Phase 5 public opening of paid editions |
| OWN-02 | Domain expires 2027-09-24 with `renew=false` (risk recorded) |
| Production cutover | **Owner blocker, deferred and out of this close**: `ALLOW_PRODUCTION_MUTATIONS=false`, DNS write by the owner, OWN-01 residual risk. Runbook `docs/runbooks/vercel-cutover-and-rollback.md` is ready |

## 7. Rollback

Nothing on `runiismty.com` changed; Netlify still serves production with its deploy, env and domain intact. The cutover runbook holds the DNS snapshot and the reverse procedure. Staging changes are reversible from the snapshots listed in section 3.

## 8. Next-phase readiness

Phase 2 can build on the Vercel platform as established; it was not started. Roadmap prerequisites: OWN-05 (Terms/Privacy acceptance) before its gate; revalidate F1/F2 journeys on Vercel with E2E, including AUD-033.

## 9. Owner Human Gate

Review at **https://staging.runiismty.com** (log in to Vercel with the team account when prompted):

1. Home, `/eventos`, an event page, `/runiis`, `/contacto` and `/legal/terminos` show real RUNIIS content (staging has no events yet, so lists may be empty).
2. Sign in with your email (6-digit OTP) or Google; complete onboarding; open `/cuenta` and its sections.
3. Expect staging-only behaviour: pages are not indexable; app email only reaches your allowlisted address.
4. Not in this phase: inscription (`/inscripcion/*`), admin and scanner return 404 by design.

Decide `APPROVE` or `REQUEST_CHANGES`.
