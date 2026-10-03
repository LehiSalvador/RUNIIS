# RUNIIS WEB — Phase 1 Report

No secret values appear in this report. Variables are named, never valued.

| Field | Value |
| --- | --- |
| phase_id | `P1-PLATFORM-REBASE` |
| phase_name | Platform Rebase, Vercel Migration & Authoritative Baseline |
| status | `TECHNICAL_PASS_WITH_OWNER_BLOCKER` (not `PHASE_APPROVED`: only the owner approves) |
| report_date | 2026-10-02 (America/Monterrey) / 2026-10-03 UTC |
| baseline_in | `staging@a9ef303` (audited) + untracked T41 WIP |
| baseline_out | local `staging@fb24ec8` (integrated code/docs; report commits follow); `origin/staging@466d980`; `origin/wip/t41-closure-partial@b34aa74`; `main`/`origin/main@bdd1198` (placeholder, untouched) |
| review URL | https://staging.runiismty.com (sign in to Vercel with the team account; see Owner Human Gate) |

## 1. Observable outcome

- The real RUNIIS V1 build (not the placeholder) runs on Vercel Preview at `staging.runiismty.com`, backed by the non-production Supabase project `brxdgvcfykmsqmhsvgxl`.
- `/api/health` reports `staging`; every page carries `noindex` and `robots.txt` disallows all; the public CSP, the nonce CSP for private pages, HSTS and other security headers are served by the real host.
- Sign-in with email OTP works end to end on staging (6-digit code, Secure/HttpOnly session cookie, onboarding reachable). Google sign-in redirects through the staging Supabase with the staging OAuth client.
- Anonymous rate limits key on the real client IP behind Vercel; forged forwarding headers do not create new buckets.
- The four HTTP workers run on Supabase `pg_cron` + `pg_net` against Vercel and record `infra.worker_run`; Netlify Scheduled Functions are gone from the code.
- GPX import fits the measured Vercel request-body limit.
- Netlify remains only as legacy placeholder and rollback for `runiismty.com`.

## 2. Work Units

| WU | Owner | Result | Commits / evidence |
| --- | --- | --- | --- |
| WU-P1-A baseline | orchestrator | COMPLETE | `afcf1cf` (audits + Roadmap versioned), T41 isolated on `wip/t41-closure-partial@b34aa74` (7 hashes verified), offline bundle in owner OneDrive, gitleaks history clean |
| WU-P1-C runtime compatibility | salvaops-backend | PASS | `621c1ce`, `7065f43` — portable client IP, truthful health, noindex outside production, GPX limits, `.env.example` |
| WU-P1-D worker scheduler | salvaops-database | PASS (worker_run gap routed to F) | `a987977`, `c53c431` — pg_cron + pg_net + Vault triggers; Netlify functions/plugin/config removed |
| WU-P1-B authority docs | salvaops-web-architect | PASS | `e17dc16`, `0b03932`, `73e0944`, `9b39693` (+ orchestrator `f72a132` master frontmatter) — Master patches (audit 9.1-9.12), ADR-002, ADR-001 supersession notes, specs T11-T13, authority map, runbooks |
| WU-P1-F CI + worker runs | salvaops-backend | PASS | `f58634a`, `11daa37`, `0886e6c`, `4959056`, `466d980`, `410bc07`, `aed5a27` — infra.worker_run recording, GPX contract cap, GitHub Actions CI, gitleaks allowlists |
| WU-P1-D2 bypass header | salvaops-database | PASS | `79b77b9` — optional `x-vercel-protection-bypass` header from Vault on worker triggers |
| WU-P1-D3 pg_net privileges | salvaops-database | BLOCKED → risk accepted | net objects are owned by `supabase_admin`; project roles cannot revoke. Compensating control verified; runbook assertion `fb24ec8` |
| WU-P1-E provider operations | orchestrator | REMOTE_INTEGRATED | `.local-state/phase-1/provider-ops.log` (secret-free) |
| WU-P1-H1 QA gate | salvaops-qa | PASS | Tier 2 on `79b77b9`; all assigned acceptance IDs PASS |
| WU-P1-H2 AppSec gate | salvaops-appsec | FAIL only on H2-01 (owner action) | platform verdicts AC-09/11/12/18 PASS_WITH_FINDINGS |
| WU-P1-H3 Integration & Evidence | salvaops-integration-evidence | READY | `.salvaops-agent-evidence/WU-P1-H3-integration-evidence/reconciliation.md` (rev 2) |
| WU-P1-G cutover | orchestrator | DEFERRED | see section 7 |

Agents used: salvaops-backend ×2, salvaops-database ×3, salvaops-web-architect, salvaops-qa, salvaops-appsec, salvaops-integration-evidence. Maximum two concurrent model actors.

## 3. Provider and infrastructure changes

| Provider | Change | Rollback |
| --- | --- | --- |
| GitHub | Ruleset `24351949` (deletion + non-fast-forward blocked on `main`, `staging`, `wip/t41-closure-partial`). Published `wip/t41-closure-partial@b34aa74` (via SalvaOps) and `staging@466d980` (fast-forward). Repository stays public (OWN-03). | Delete ruleset; refs are additive |
| Vercel `runiis-web` | 24 shared env entries narrowed to Production; `APP_ENV=production` added; Production `APP_BASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `INTERNAL_CRON_SECRET`, `PASS_CREDENTIAL_ENCRYPTION_KEY_V1` set from owner source. Preview: staging-only values for all server variables, `EMAIL_DELIVERY_MODE=capture`; branch `staging`: `allowlist` + owner address + Brevo. Domains: apex primary, `www → apex 308`, `staging.runiismty.com` bound to branch `staging`. Protection Bypass for Automation created (secret only in staging Vault). | Env/domain snapshot in checkpoint; revoke bypass in project settings |
| Supabase staging `brxdgvcfykmsqmhsvgxl` | 68/68 migrations (no T41, no seed); Auth site URL `https://staging.runiismty.com`, redirect allowlist for staging and team preview URLs, OTP 6 digits / 600 s, `before_user_created` hook on; Vault: worker base URL, worker cron secret, Vercel bypass. QA fixture user `qa.phase1.gate@example.com` retained (non-production). | Pre-migration schema dump `.local-state/phase-1/staging-schema-before.sql`; auth snapshot `.local-state/phase-1/auth-config-before.jsonl` |
| Supabase production `mdzhsoeqagtwznybwtuy` | Auth only (2026-10-02, before the production guard): OTP 6/600 s, allowlist `https://runiismty.com/**`. No schema change. | Auth snapshot above |
| Brevo | None (read-only: free plan, 300/day, domain authenticated, Authorized-IP blocking disabled for API and SMTP) | — |
| Netlify | None. Placeholder production deploy, env and domain kept as rollback. | — |
| DNS | None. `runiismty.com` and `www` still resolve to Netlify. | — |

## 4. Tests and remote verification

Tier 2 (QA, local, commit `79b77b9`): `pnpm install --frozen-lockfile`, lint, typecheck, unit 510/510, pgTAP 1049/1049 (34 files), integration 62/62, build, gitleaks history (69 commits) — all PASS. Since then only D2 (pgTAP 702 added, run by its owner: 34 files / 1049 PASS) and docs commits landed; D3 changed nothing.

Remote probes (orchestrator, staging, evidence `.salvaops-agent-evidence/P1-GATE/gate-probes.log`):

| Check | Result |
| --- | --- |
| Routes `/`, `/eventos`, `/entrar`, `/cuenta`, `/runiis`, `/contacto`, `/legal/*`, sitemap | 200, real RUNIIS pages; future routes `/inscripcion`, `/admin`, `/scanner` → controlled 404 |
| Health / indexing | `{"environment":"staging"}`; `X-Robots-Tag: noindex, nofollow`; `robots.txt` = `Disallow: /` |
| Headers | public CSP on cached pages; nonce + `strict-dynamic` CSP on private pages; HSTS preload; nosniff; `X-Frame-Options: DENY`; `no-referrer` on `/auth/callback`; `camera=(self)` only on `/scanner` |
| Auth OTP | admin-generated 6-digit code → 200 with Secure/HttpOnly/SameSite cookie → session authenticated → `/onboarding` |
| Google OAuth | app → staging Supabase authorize → Google with the staging client ID; no `redirect_uri_mismatch` |
| Client IP / rate limit | 11th wrong code → 429; forged XFF/X-Real-IP/x-vercel-forwarded-for → still 429; same email from Supabase egress → 400 (separate bucket) |
| GPX body limit | 4.33 MB and 4.45 MB reach the app; 4.6 MB and 7.5 MB → platform 413 `FUNCTION_PAYLOAD_TOO_LARGE` |
| Workers | pg_cron → pg_net → Vercel: all 4 HTTP workers plus the 5-minute DB workers (`close-registration-windows`, `expire-registration-requests`) `SUCCEEDED` in `infra.worker_run` (daily `archive-guests` not yet due in the observed window), 0 stale RUNNING; wrong/absent Bearer → 401, no run |
| Exposure | without credentials staging and worker routes return Vercel SSO 302; PostgREST rejects `net`, `vault`, `app`, `private`, `cron` (406); GraphQL disabled |
| Email safety | branch `staging` `allowlist`; other previews `capture`; Production has no mode → refuses to send |
| Secrets | gitleaks history/tree clean; value scan of tracked tree, docs and evidence: 0 hits |

Not run: GitHub Actions CI (blocked, section 6), E2E (out of Phase 1 gate scope; Phase 2 revalidates journeys on Vercel), real email delivery.

## 5. Findings

Closed in Phase 1: AUD-002 (scheduler), AUD-003 (single copy: code published), AUD-004 (client IP), AUD-005 (env separation), AUD-010 (apex/www direction in Vercel), AUD-014 (authority/SalvaOps index), AUD-015 (GPX limit, measured), AUD-021 (preview env no longer carries production values), AUD-023 (redirect allowlists), AUD-025 (specs/decisions versioned), AUD-028 (health), AUD-030 (`.env.example`), AUD-038; P1-F-01 remote OTP 8 → 6 digits; P1-F-05 HTTP workers now record `infra.worker_run`; Brevo authorized-IP blocking verified disabled.

Open:

| ID | Severity | Owner | Summary |
| --- | --- | --- | --- |
| H2-01 / SEC-INC-01 | critical | owner | The exposed Supabase PAT is identified as the value of `SUPABASE_ACCESS_TOKEN_CURRENT_LIMITED` (the orchestrator no longer uses it). It must be revoked in the Supabase dashboard. Not needed by any runtime; not tracked; does not block staging. |
| CI-RUN / AUD-016 | high (gate item) | owner | The GitHub PATs lack the `workflow` scope, so the local commits after `466d980` that include `.github/workflows/ci.yml` (and the Master, ADR-002, specs, runbooks) cannot be pushed and CI has never run on GitHub. |
| H2-12 | low (accepted) | orchestrator | pg_net default grants for anon/authenticated cannot be revoked by project roles; accepted with the verified compensating control and the runbook assertion. |
| H2-03, H2-04, H2-05, H2-06, H2-07, H2-08, H2-09, H2-11 | low/info | various | Bypass secret is project-wide (rotate on need); staging Brevo key comes from the single Brevo account; worker base URL accepts http/any host (Vault write required); staging redirect wildcard covers the team's preview URLs; remote Auth abuse controls not evidenced; CI actions pinned to major tags; client-IP residuals (Netlify header off Vercel, IPv6 /64); QA fixture user retained. Triage before Phase 5. |
| P1-F-08 | info | — | Vercel Authentication also protects the branch-bound staging custom domain (the audit assumed exempt). Owner views after Vercel login; machines use the automation bypass. |
| P1-F-10 | low | SalvaOps | `salvaops git push --branch` captures the current HEAD, not the named branch; one wrong-commit request was approved but never executed. |
| P1-F-11 | low | owner | The Production deployment predates `APP_ENV=production` (health reports `staging`); a redeploy is deferred under `ALLOW_PRODUCTION_MUTATIONS=false`. |
| AUD-033 | low | frontend (Phase 2) | Anonymous `/cuenta` streams 200 under `loading.tsx` before redirecting. |

## 6. Owner decisions and blockers

| Item | State |
| --- | --- |
| OWN-03 | RESOLVED 2026-10-01: repository stays public and is published |
| OWN-01 | Owner position: V1 processes no payment on the platform (WhatsApp quote only). Residual Vercel fair-use risk to re-confirm before the Phase 5 public opening of paid editions |
| OWN-02 | Domain expires 2027-09-24 with `renew=false` (risk recorded, no action) |
| Workflow scope | **Blocker** — grant `Workflows: Read and write` to the GitHub fine-grained PAT, then the orchestrator pushes and records the first CI run |
| SEC-INC-01 | **Blocker (security)** — revoke the identified token |
| Cutover | Deferred: production guard `ALLOW_PRODUCTION_MUTATIONS=false`, DNS write needs the owner, OWN-01 residual risk |

## 7. Rollback, Netlify, Vercel, Supabase state

- Rollback: nothing on `runiismty.com` changed; Netlify still serves production. Runbook `docs/runbooks/vercel-cutover-and-rollback.md` holds the DNS snapshot (`@ A 75.2.60.5`, `www CNAME runiis-web.netlify.app`) and the procedure for when the cutover is authorized.
- Netlify: legacy placeholder + rollback only; no new Netlify architecture; code dependencies removed.
- Vercel: Production = `main@bdd1198` placeholder; Preview `staging` = `466d980` READY on `staging.runiismty.com`.
- Supabase: staging = V1 schema (68 migrations) and active workers; production = no V1 schema, Auth OTP/allowlist aligned, no mutation since the guard.

## 8. Next-phase readiness

Phase 2 can build on the Vercel platform as established. It is not started. Phase 2 prerequisites from the Roadmap: OWN-05 (Terms/Privacy acceptance) before its gate; revalidate F1/F2 journeys on Vercel (E2E), including AUD-033.

## 9. Owner Human Gate

Review at **https://staging.runiismty.com** (log in to Vercel with the team account when prompted):

1. Home, `/eventos`, an event page, `/runiis`, `/contacto`, `/legal/terminos` render real RUNIIS content (no events exist yet in staging, so lists may be empty).
2. Sign in with your email (OTP arrives from Supabase/Brevo, 6 digits) or with Google; complete onboarding; open `/cuenta` and its sections (friends, guests, guardians, requests, passes).
3. Confirm the staging-only behaviour you expect: noindex, email only to your allowlisted address.
4. Not in this phase: inscription flow (`/inscripcion/*`), admin, scanner, rankings — they return 404 by design.

Decide: `APPROVE` or `REQUEST_CHANGES`. Before or with approval: revoke the exposed Supabase PAT and grant the PAT workflow scope so CI can run.
