# RUNIIS — Phase 1 Packet (JIT)

| Field | Value |
| --- | --- |
| phase_id | `P1-PLATFORM-REBASE` |
| phase_name | Platform Rebase, Vercel Migration & Authoritative Baseline |
| created | 2026-10-01 (America/Monterrey) by the Phase 1 orchestrator |
| baseline_in | `staging@a9ef303` (audited) + T41 untracked WIP; after WU-P1-A: `staging@afcf1cf`, `wip/t41-closure-partial@b34aa74` |
| authority | Master `docs/RUNIIS_WEB_SYSTEM_MASTER_SPEC_V2.md` (sha256 `dbde4231…42bc`) > ADR-001 (+A1) > Roadmap `docs/RUNIIS_EXECUTION_ROADMAP_V1.md` §7 > this packet > Task Envelopes |
| inputs | `docs/audits/RUNIIS_MASTER_AUDIT_REPORT_V1.md`, `…_CURRENT_IMPLEMENTATION_BASELINE_V1.md`, `…_NETLIFY_TO_VERCEL_MIGRATION_READINESS_V1.md` |
| machine state | Task Envelopes `.local-state/envelopes/P1/`, checkpoints `.salvaops-agent-evidence/<task_id>/checkpoint.json`, orchestrator checkpoint `.local-state/phase-1/orchestrator-checkpoint.json` |

No secret values appear in this packet. Variables are reported as PRESENT / MISSING / UNKNOWN only.

## 1. Objective and observable outcome

Make Vercel the real platform for the remaining RUNIIS work while preserving V1. At close: baseline durable; authority coherent; Master reconciled with Vercel; specs T11/T12/T13 versioned; `staging.runiismty.com` serves the real V1 build from a Vercel Preview on a non-production Supabase; Production/Preview environments separated; `APP_ENV` truthful; anonymous rate limits key on a portable, spoof-resistant client IP; HTTP workers triggered without Netlify; GPX import compatible with the Vercel body limit; Auth redirects and OTP correct per environment; Preview email cannot reach real recipients unintentionally; CI exists; Netlify reduced to legacy placeholder + rollback. Cutover of `runiismty.com` only if OWN-01 is resolved.

## 2. Baseline reconciliation (2026-10-01, after audit)

| Surface | Audit state | Re-verified now | Change |
| --- | --- | --- | --- |
| Git | `staging@a9ef303`, 37 ahead of `origin/staging`, T41 untracked, `next-env.d.ts` dev artifact | identical | none |
| GitHub | public, `main@bdd1198`, `staging@89b79d4`, unprotected | identical | none |
| Vercel project `runiis-web` | Hobby, Git-linked, prod branch `main`, 24 sensitive env shared prod+preview, apex→www 308 | identical (project, env metadata, domains, deployments) | none |
| DNS / HTTP | apex+www → Netlify placeholder (`production`), Vercel tech URL health `staging`, `staging.runiismty.com` DEPLOYMENT_NOT_FOUND | identical | none |
| Supabase staging `brxdgvcfykmsqmhsvgxl` | UNKNOWN | ACTIVE_HEALTHY; Auth site_url = Netlify staging; allowlist Netlify staging + localhost:3000; OTP length **8**; `before_user_created` hook **off** | new facts |
| Supabase prod `mdzhsoeqagtwznybwtuy` | UNKNOWN | ACTIVE_HEALTHY; site_url apex; allowlist includes Netlify staging; OTP length **8**; hook **off** | new facts |
| SalvaOps | Broker 1.3.1, Desktop closed | Desktop closed: `git.push`, `vercel.*`, `supabase.*`, `github.*` UNAVAILABLE; index still points MASTER at the placeholder | none |
| Roadmap | n/a | copied verbatim into `docs/` (sha256 `2900925a…f1`) | versioned |

Access facts: the owner's provider-access tokens are narrowly scoped — Vercel token reads/writes project config but cannot read DNS records or the team; Supabase token reads/writes Auth config but lacks `database_read/write` and `api_gateway_keys_read`. Staging Supabase keys and a staging DB credential are MISSING from every accessible source.

## 3. Scope

In scope (Roadmap §7.4–§7.15): baseline protection; authority reconciliation; Master patches from audit §9; ADR-002 (hosting, scheduler, client IP, environment model, ALTCHA, Netlify decommission); promotion of T11/T12/T13; Vercel normalization; environment model; Preview backend (OPEN-02); client IP; workers; GPX; Auth/URLs; email safety; CI; Netlify code retirement after replacement; staging Preview; cutover preparation (execution only if OWN-01).

Out of scope: Registration/Admin/Scanner UI, T41 completion, rankings, avatars, sanctions, Task Center, PostHog/Sentry SDK integration, production DB migration of V1 schema, deploying V1 to Production, Brevo webhook registration, any billing.

## 4. Owner decisions and external blockers

| ID | State at packet creation | Effect |
| --- | --- | --- |
| OWN-03 GitHub visibility | RESOLVED 2026-10-01 by owner: keep public and publish | Push `staging` + `wip/t41-closure-partial` via SalvaOps `git.push` once Desktop is open, after Vercel env separation; protect branches against force-push/deletion (free on public). |
| OWN-01 Vercel commercial use | OWNER POSITION 2026-10-01: V1 processes no payment on the platform; paid registration is only a WhatsApp quote hand-off; in-platform payment is V2 | Cutover may proceed (production keeps serving the placeholder). Residual risk recorded: Vercel fair-use lists "requesting or processing payment from visitors"; re-confirm before the Phase 5 public opening of paid EXTERNAL_WHATSAPP editions. DNS write needs owner action (scoped token cannot read/write DNS). |
| OWN-02 domain renewal | OPEN (risk only, expires 2027-09-24) | none in Phase 1 |
| Staging Supabase access | Owner chose SalvaOps Desktop; SalvaOps `supabase.*` capabilities are bound to the production `project_ref` | Preview backend blocked until a staging-scoped binding or staging credentials exist |
| Staging email | RESOLVED: staging branch `allowlist` with the owner account address; generic Preview `capture` | — |
| SalvaOps Desktop closed | external | typed capabilities unavailable; read-only fallbacks used |
| SEC-INC-01 | Supabase PAT exposed in an orchestrator tool output (bare line in the provider-access file) | owner should rotate it; never used |

## 5. Decisions taken in this packet (IMPLEMENTATION_FLEXIBLE, to be recorded in ADR-002)

1. OPEN-01 → Supabase `pg_cron` + `pg_net` POST to the existing Vercel worker routes, Bearer `INTERNAL_CRON_SECRET` read from Supabase Vault per environment; no Netlify, no Vercel Cron.
2. OPEN-02 → Preview backend = remote Supabase `brxdgvcfykmsqmhsvgxl` (non-production, never authoritative), once access exists. Production DB is never used by Preview.
3. Environment mapping: Vercel Production (`main`) = production; Vercel Preview branch `staging` + `staging.runiismty.com` = staging; generic Preview = staging non-production values with `EMAIL_DELIVERY_MODE=capture`. Existing shared env entries are narrowed to Production (values unread, provenance UNKNOWN, re-verify before V1 production release).
4. Provider configuration (Vercel env/domains, Supabase Auth config, Vault values) is executed by the orchestrator: SalvaOps typed capabilities do not cover these writes and specialists may not hold credentials. Every such action is logged secret-free in the orchestrator checkpoint.
5. Remote Auth OTP length aligned to Master §17 (6 digits) — the app rejects anything else.

## 6. Work Unit DAG

```
A (done) ──► C ─┐
         └─► D ─┼─► B ─┐
                │      ├─► E (provider ops, needs owner access) ─► H (gate)
                └─► F ─┘
G (cutover) ── BLOCKED by OWN-01
```

| WU | Owner | Goal | Depends | Locks |
| --- | --- | --- | --- | --- |
| WU-P1-A | orchestrator | Baseline manifest, secret scan, T41 isolated on `wip/t41-closure-partial`, offline bundle, audit+Roadmap versioned | — | repo-write (done) |
| WU-P1-C | salvaops-backend | Portable client IP + tests; truthful health/APP_ENV; robots/noindex per env; GPX body-limit compatibility; `.env.example` | A | repo-write: `lib/server/http/**`, `app/api/health/**`, `app/robots.ts`, GPX route+parser, `.env.example`, related tests |
| WU-P1-D | salvaops-database | `pg_net` + Vault-configured `pg_cron` triggers for the 4 HTTP workers; local proof via `infra.worker_run`; then remove Netlify functions/deps/config | A | db-schema + db-integration (via `scripts/db.mjs` lock); repo-write: `supabase/migrations/<new>`, `supabase/tests/database/<new>`, `netlify/**`, `netlify.toml`, `package.json`, `pnpm-lock.yaml` |
| WU-P1-B | salvaops-web-architect | Master patches (audit §9), ADR-002, ADR-001 supersession notes, specs T11/T12/T13 → `docs/specs/`, `docs/README.md` authority map, cutover/rollback runbook, AGENTS/CLAUDE + SalvaOps index pointing to real authority | C, D (for ADR facts) | repo-write: `docs/**` (except audits/execution), `AGENTS.md`, `CLAUDE.md`, `00_Documentacion/**` |
| WU-P1-F | salvaops-backend | GitHub Actions CI (install, lint, typecheck, unit, pgTAP, integration, build, gitleaks) | C, D | repo-write: `.github/**`, `.gitleaks.toml` |
| WU-P1-E | orchestrator (provider ops) | Vercel env split, staging branch domain, apex primary, auto-deploy policy; staging Supabase migrations/Auth/Vault; Preview deploy; GPX/IP/health/header probes | C, D, F, owner access | provider-mutation |
| WU-P1-H | salvaops-qa, salvaops-appsec, salvaops-integration-evidence | Technical gate checks on Preview + repo | E | browser, read-only |
| WU-P1-G | orchestrator | Cutover | OWN-01 | BLOCKED |

Concurrency: max two heavy writers (C ∥ D first; then B ∥ F). No two writers share a path. DB mutations only under the existing `scripts/db.mjs` lock.

## 7. Acceptance IDs

P1-AC-01 baseline durable · P1-AC-02 T41 preserved/isolated · P1-AC-03 authority fixed · P1-AC-04 Master reconciled · P1-AC-05 Roadmap discoverable · P1-AC-06 specs versioned · P1-AC-07 ADR-002 · P1-AC-08 Vercel normalized · P1-AC-09 env separated · P1-AC-10 APP_ENV/health truthful · P1-AC-11 client IP portable + anti-spoof · P1-AC-12 workers provider-independent, no duplicate scheduler · P1-AC-13 GPX compatible · P1-AC-14 Preview DB isolation · P1-AC-15 Auth redirects/URLs/OTP · P1-AC-16 Preview email safe + Brevo IP status · P1-AC-17 CI exists/PASS · P1-AC-18 no tracked secrets · P1-AC-19 no active Netlify dependency · P1-AC-20 rollback documented · P1-AC-21 staging runs V1 · P1-AC-22 Integration & Evidence READY · P1-AC-23 cutover (conditional OWN-01).

## 8. Risk register

| ID | Risk | Mitigation |
| --- | --- | --- |
| R1 | Production secrets reach Preview | Narrow shared entries to Production before any Preview deploy; Preview gets staging values only |
| R2 | Staging indexed | `robots`/`X-Robots-Tag` noindex when `APP_ENV!=production` |
| R3 | Worker double execution during coexistence | Netlify functions were never deployed (AUD-038); leases + `dedupe_key`; Netlify code removed only after local proof |
| R4 | Login broken remotely (8-digit OTP) | Align remote OTP length to 6 |
| R5 | T41 lost/mixed | Isolated branch + hash proof + bundle; platform commits never touch T41 paths |
| R6 | Local DB contention between WUs | `scripts/db.mjs` lock; C runs unit tests only unless it holds the lock |
| R7 | Hobby limits / commercial terms | OWN-01; no cutover |
| R8 | Brevo authorized-IP blocking | Verify status read-only (AUD-006) |

## 9. Testing strategy and Technical Gate

Tier 0/1 inside each WU. Tier 2 at gate: lint, typecheck, unit, pgTAP, integration, build once on the integrated commit; gitleaks history+tree; Preview smoke (routes, health=staging, headers/CSP, robots noindex), client-IP bucket separation and spoof attempt on Preview, worker trigger → `infra.worker_run` on staging, GPX limit probe, env isolation audit (metadata only), Auth redirect/OTP config read-back, Brevo IP status, CI run (after OWN-03), rollback readiness check. Integration & Evidence verdict required.

## 10. Evidence contract

Per WU: `.salvaops-agent-evidence/<task_id>/` (checkpoint.json, logs, handoff). Orchestrator provider-op log: `.local-state/phase-1/provider-ops.log` (secret-free). Durable summary: `docs/execution/phase-1/PHASE_1_REPORT.md`.
