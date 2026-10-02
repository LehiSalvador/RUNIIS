# RUNIIS WEB — Phase 1 report

| Field | Value |
| --- | --- |
| phase_id | `P1-PLATFORM-REBASE` |
| phase_name | Platform Rebase, Vercel Migration & Authoritative Baseline |
| status | `BLOCKED` |
| report_date | 2026-10-02 |

## Baseline in / out

- Input: audited baseline `staging@a9ef303`; T41 isolated at `b34aa74`.
- Integrated application output before this report commit: `staging@aed5a27484b4d456b9ba22319d97ed42e1759c27`, clean worktree, 55 commits ahead of `origin/staging@89b79d4791c79137a0e18b0845f3e0086acfa19f`.
- `main@bdd1198b931b3c5a85270408eb21ab39a45b35f7`; T41 local `b34aa74d94be79a15a6d814e3ce53cd0002ee08d`, no remote ref.

## Work units and commits

| Unit | Status | Evidence |
| --- | --- | --- |
| WU-P1-A | COMPLETE_LOCAL | Baseline manifest, T41 isolation, bundle and audits recorded in checkpoint. |
| WU-P1-C | PASS | `621c1ce`, `7065f43`; runtime compatibility and GPX/client-IP changes. |
| WU-P1-D | PASS with WU-P1-F remediation | `a987977`, `c53c431`, `f58634a`; pg_cron/pg_net design, Netlify scheduling removal, worker run recording covered by integrated tests. |
| WU-P1-B | PASS | `9b39693`; Master, ADR, authority map and specs. |
| WU-P1-F | PASS | `aed5a27`; CI and worker remediation. |
| WU-P1-E | BLOCKED | Provider changes partially complete; staging binding, PAT revocation, push, remote migrations and Preview remain blocked. |
| WU-P1-H | WAITING_E | Requires WU-P1-E and a real staging Preview. |
| WU-P1-G | BLOCKED | Cutover readiness gate not met; DNS unchanged. |

## Tests and evidence

Last integrated validation recorded for WU-P1-F: unit 510 PASS; pgTAP 1,033 PASS; integration 62 PASS; lint, typecheck, build, actionlint and gitleaks PASS. No full suite rerun because no code changed in this continuation. Current worktree remains clean.

## Provider and SalvaOps state

- Vercel: Production/Preview environment separation and domain normalization recorded in `provider-ops.log`; production deployments exist on `main`; no `staging` Preview deployment exists. Staging Preview keys remain incomplete.
- Supabase production: project active; Auth OTP 6 digits / 600 seconds and production URL allowlist changes recorded. SalvaOps binding remains environment-neutral and targets the production project.
- Supabase staging: dashboard confirms staging project and API keys exist. SalvaOps has zero staging bindings; its `staging` lookup still resolves to the production project. No staging keys are stored in SalvaOps or synced to Preview.
- SalvaOps: 27 approvals are APPROVED, none pending; secret destinations list is empty. Native Desktop process exists, but current Computer Use surface exposes no native app/window controls. Binding/connection changes are Desktop-only; no bypass used.
- Brevo: read-only Dashboard check shows Authorized IP blocking disabled for API and SMTP. No setting changed.
- GitHub: staging branch unprotected. Ruleset form configured for `main`, `staging`, and `wip/t41-closure-partial`, with deletion restriction and force-push blocking only; save triggered identity verification to an unavailable mailbox. No ruleset was saved. GitHub branch protection remains unverified/unconfigured.
- Netlify: legacy rollback only; no deletion or disconnect performed.
- DNS: unchanged. No cutover; `CUTOVER_READY` is absent.

## Findings closed

- WU-P1-B and WU-P1-F accepted PASS.
- Historical gitleaks false positive allowlist and worker-run recording remediation are included in WU-P1-F evidence.
- Brevo API/SMTP Authorized IP blocking already disabled.

## Findings open / blockers

1. `SEC-INC-01`: exposed Supabase PAT line removed from local access file, but token not revoked. Account lists multiple scoped tokens; exact exposed token could not be proven after the stray line was removed. No token was revoked to avoid disabling the wrong SalvaOps connection.
2. Supabase staging binding missing; current `staging` binding resolves to production. No staging keys in SalvaOps; secret destinations empty.
3. GitHub ruleset creation blocked by email identity verification sent to a mailbox unavailable in authenticated sessions. Branch protections remain absent.
4. `staging` and isolated T41 branches remain unpublished. No staging DB migrations, Preview deployment or Tier 2 Preview probes.
5. OWN-01 fair-use risk remains a pre-public-opening gate. DNS cutover remains deferred until all packet gates read `CUTOVER_READY`.

## Security incident closure

Not closed. The accidentally exposed PAT line was removed and repository history/tree gitleaks scan was clean, but the PAT itself remains active/unrevoked. No secret values are recorded in this report, checkpoint or provider log.

## Rollback and next-phase readiness

No provider rollback needed for this continuation; no new provider mutation completed. Existing Vercel/Supabase changes and offline Git bundle remain recorded in the packet/checkpoint. Fase 2 is not ready and was not started.

## Owner human gate

External access needed to resume: make the GitHub identity-verification mailbox accessible to the existing session, and expose SalvaOps Desktop to the supported Computer Use window surface (or provide an equivalent supported SalvaOps Desktop control path). Then complete staging binding/secret destination and secure token identification/revocation before any push, migration or Preview deploy.
