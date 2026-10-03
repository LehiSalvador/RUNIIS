# RUNIIS WEB — Phase 2 Report

No secret values appear in this report. Variables are named, never valued. This is the single authoritative Phase 2 state.

| Field | Value |
| --- | --- |
| phase_id | `P2-PARTICIPANT-EXPERIENCE` |
| phase_name | Complete Participant Experience (Roadmap §8) |
| status | `CLOSED — APPROVED_BY_OWNER` (owner decision 2026-10-03). Technical result before the owner gate: `TECHNICAL_PASS` (QA PASS after remediation, AppSec PASS, Integration & Evidence READY) |
| owner_decision | `OWNER_DECISION=APPROVE` (2026-10-03), no changes requested; anti-hoarding decision OD-P2-01 recorded (section 6) |
| report_date | 2026-10-03 (America/Monterrey / UTC) |
| baseline_in | `staging@d5ecefd` (Phase 1 closed, owner-approved) → Phase 2 Packet `719296e` |
| baseline_out | `staging` = `origin/staging` (this report's commit, see `git log -1 origin/staging`); last integrated code commit before the report: `6b68f9d`; `origin/wip/t41-closure-partial@b34aa74` (isolated, untouched); `main`/`origin/main@bdd1198` (placeholder, untouched) |
| review URL | https://staging.runiismty.com (sign in to Vercel with the team account when prompted) |

## 1. Observable outcome

- A participant can open an event on staging, press the registration CTA, sign in (or resume after sign-in), complete onboarding with explicit acceptance of the current Terms and Privacy versions, and register at `/inscripcion/{slug}`.
- **FREE** editions confirm at once (no hold): the request becomes a registration and the participant gets a pass with a server-rendered QR in `/cuenta/pases`.
- **WhatsApp** editions (V1 has no on-platform payment, OWN-01) create a request with an absolute 24 h hold (`min(created_at + 24 h, registration_close_at)`, no extension): the participant sees the reference, total, server-time countdown, the `wa.me` link and can cancel; it is never shown as paid until staff confirms; when the hold runs out it shows as expired even if the worker has not run yet, and the place is released.
- Participants: the account holder, accepted Friends (an adult Friend accepts the event documents personally, from a deep link), owned Guests (no credit language), and minors 15–17 through a verified guardian (the guardian accepts for the minor). Under-15 and minors without a guardian are rejected with clear messages.
- Capacity is derived: when the last place is held it shows "temporarily unavailable", not "sold out"; in a last-slot race exactly one buyer wins.
- Event documents (sport waiver, event rules, minor terms) are accepted per registration and per participant; a new Terms/Privacy version asks READY users to re-accept before registering.
- Account area: requests and registrations kept apart, passes with credential state (a revoked/replaced credential is never shown as a valid QR), communication preferences.
- Staging email delivers only to the owner's allowlisted address; every other recipient is suppressed terminally (no retries, no budget use).

## 2. Work Units

| WU | Owner | Result | Commits |
| --- | --- | --- | --- |
| P2-A harness + AUD-033 | salvaops-frontend | PASS | `851e04f`, `8daff0b`, `c3e2174`, `773e3b2` |
| P2-B legal + registration context | salvaops-backend | PASS | `720fb1b`, `3c0faf8` (migrations 160, 161; staging QA fixture script) |
| P2-B2 resume redirect + seed | salvaops-backend | PASS | `84efbfe` |
| P2-C `/inscripcion/[slug]` | salvaops-frontend | PASS | `6c17f7b` |
| P2-C2 nav to built routes only | salvaops-frontend | PASS | `78f51ca`, `fffe9e4` |
| P2-D onboarding legal, requests, passes | salvaops-frontend | PASS | `9aba20f` |
| P2-E participant journeys (E2E) | salvaops-frontend | PASS | `1bb7050` |
| P2-F provider operations | orchestrator | COMPLETE | `.local-state/phase-2/provider-ops.log` (secret-free) |
| P2-G1 admin request list 500 | salvaops-backend | PASS | `2b9d6e7` |
| P2-G2 edition documents screen | salvaops-frontend | PASS | `a92ffc6` |
| P2-G3 guardian pending actions | salvaops-backend | PASS | `342ac15` (migration 162) |
| P2-G4 guardian/Friend deep-link journeys | salvaops-frontend | PASS | `8b45b4b` (+ `0558c7c` README) |
| P2-G5 onboarding identity guard (AppSec) | salvaops-backend | PASS | `7bf6394` (migration 163) |
| P2-G6 draft isolation + harness hardening (AppSec) | salvaops-frontend | PARTIAL → closed by P2-G7 | `b55acf9`, `10b0fe4`, `f278391` |
| P2-G7 spec robustness | salvaops-frontend | PASS | `e2032be` |
| P2-G8 F2 product fix + local E2E determinism (QA) | salvaops-frontend | PASS | `5ea2c96`, `6b68f9d` |
| P2-G9 staging allowlist suppression | salvaops-integrations | PASS | `14873ea` (migration 164) |
| P2-H1 QA Tier 2 | salvaops-qa | FAIL on `e2032be` → remediated | `.salvaops-agent-evidence/P2-H1-qa-gate/` |
| P2-H1b QA recheck | salvaops-qa | PASS (AC-13 delivery sub-item OWNER_BLOCKED) on `6b68f9d` | `.salvaops-agent-evidence/P2-H1b-qa-recheck/` |
| P2-H2 AppSec | salvaops-appsec | PASS_WITH_FINDINGS on `0558c7c` | `.salvaops-agent-evidence/P2-H2-appsec-gate/` |
| P2-H2b AppSec recheck | salvaops-appsec | PASS on `e2032be` | `.salvaops-agent-evidence/P2-H2b-appsec-remediation-recheck/` |
| P2-H3 Integration & Evidence | salvaops-integration-evidence | **READY** on `6b68f9d` | `.salvaops-agent-evidence/P2-H3-integration-evidence/reconciliation.md` |

Agents used: salvaops-frontend ×10, salvaops-backend ×5, salvaops-integrations, salvaops-qa ×2, salvaops-appsec ×2, salvaops-integration-evidence; at most two concurrent model actors.

## 3. Provider and infrastructure state

| Provider | State | Rollback |
| --- | --- | --- |
| GitHub | `origin/staging` fast-forwarded `d5ecefd → … → 6b68f9d` → this report, 15 pushes, no force push, no history rewrite. Ruleset `24351949` unchanged. T41 not merged. | Refs are additive |
| GitHub Actions | CI **success on all 15 pushed heads** (`.salvaops-agent-evidence/P2-GATE/ci-per-pushed-head.txt`); last `37144349651` on `6b68f9d`. | — |
| Vercel `runiis-web` | Preview `staging` = `6b68f9d`, `dpl_4J2CzKtQU6MPgWQSRQ7wjoXeSc6h` READY, aliased to `staging.runiismty.com`. One project change: `enablePreviewFeedback=false` (the Vercel Toolbar script on Preview broke the CSP). Production unchanged (`main@bdd1198` placeholder). | Previous Preview deployments kept (re-alias); toolbar setting back to default |
| Supabase staging `brxdgvcfykmsqmhsvgxl` | **73/73 migrations**, Phase 2 adds 160 account legal acceptance, 161 registration context, 162 guardian pending actions, 163 onboarding identity guard, 164 comms allowlist suppression. 82 `app` tables, RLS on all; 7 cron jobs active and succeeding. QA fixtures (owner review editions `qa-p2-gratis` FREE and `qa-p2-whatsapp` WhatsApp, both OPEN with **0 requests**; QA placeholder legal versions; a QA admin) created only through the real admin API. Each remote E2E run made its own `qa-e2e-<run>` editions and hid them afterwards (58 HIDDEN). Data fix: today's phantom Brevo usage counter reset 198 → 0 (0 real sends; logged with its rollback). | Forward-fix by migration; fixtures labelled QA |
| Supabase production `mdzhsoeqagtwznybwtuy` | **No change.** `ALLOW_PRODUCTION_MUTATIONS=false` respected. | — |
| Email (Brevo) | Staging `allowlist` (owner address only). Non-allowlisted recipients are now `CANCELED / NOT_ALLOWLISTED` with 0 attempts and 0 budget (verified on staging, `staging-comms-after-G9.txt`). | — |
| Netlify / DNS | Unchanged; `runiismty.com` still served by the Netlify placeholder. No cutover. | — |

Secrets: only the two authorized sources were used; no value in Git, docs, evidence, checkpoint or logs (gitleaks over all refs: no leaks; value scan of the tree and evidence: 0 hits).

## 4. Tests and remote verification

Local Tier 2 (QA, independent):

| Suite | `e2032be` (P2-H1) | `6b68f9d` (P2-H1b) |
| --- | --- | --- |
| install (frozen), lint, typecheck, build | PASS | (unchanged areas; CI green on `6b68f9d`) |
| unit | 767/767 | 781/781 |
| pgTAP (fresh reset) | 1147/1147 | 1171/1171 |
| integration | 86/86 | communications + registration 39/39 (one vitest worker crash, file green on rerun) |
| E2E chromium-desktop (2 workers) | 150 / **5 fail** / 4 skip | **155 / 0 / 4** |
| E2E chromium-mobile (1 worker) | 109 / **2 fail** / 48 skip | **111 / 0 / 48** |
| E2E chromium-tablet (1 worker) | 109 / **2 fail** / 48 skip | **111 / 0 / 48** |
| gitleaks (all refs) | no leaks | — |

Remote E2E against staging (orchestrator, Vercel bypass + per-run isolated fixtures; `.salvaops-agent-evidence/P2-GATE/INDEX.md`):

| Deploy | Desktop | Mobile | Tablet |
| --- | --- | --- | --- |
| `fffe9e4` (first full journeys) | 27 / 0 / 4 | 19 / 0 / 12 | 19 / 0 / 12 |
| `0558c7c`, `f278391` | 27 / 0 / 4, 1 flaky | 19 / 0 / 12, 1 flaky | 19 / 0 / 12, 1 flaky |
| `6b68f9d` (final) | **28 / 0 / 4** | **19 / 0 / 12**, 1 flaky | **19 / 0 / 12**, 1 flaky |

The single flake (middle runs, and mobile/tablet on the final head; it passed on its automatic retry every time) is the UI sign-in hitting the staging limit of 30 verifications per 10 minutes per IP late in a run (the product answered 429 correctly; the harness waits and retries). Remote skips are local-only journeys (SQL fast-forward of expiry, revoked pass) and desktop-only plumbing.

Security: AppSec PASS_WITH_FINDINGS, recheck PASS — no open critical or high finding.

Integration & Evidence: READY — all 25 commits in `719296e..6b68f9d` map to a Work Unit, no T41 path, origin equals the claimed head, migrations 73 = staging, CI success on every pushed head, no secret in the range or the evidence.

Not separately evidenced: reduced-motion behaviour (axe and keyboard journeys pass); lint, typecheck and build on `6b68f9d` rest on CI (QA ran them on `e2032be`).

## 5. Findings

Fixed in this phase (each verified by the owner of the check):

- **F2 (QA, product)**: a late draft restore replaced what the buyer had just chosen (a 5K click became a 10K auto-selected earlier) → `5ea2c96`.
- **P2-F-11 (orchestrator, product)**: on staging every non-allowlisted email went to an unreachable capture sink, was retried 8 times, ended FAILED and consumed the Brevo daily budget (198/300 with nothing sent) → `14873ea` + migration 164, verified on staging.
- **H2P2-01 (AppSec, medium)**: onboarding could rewrite name, date of birth and sex after the profile was READY (age-rule bypass) → `7bf6394`.
- H2P2-03/04/05/06 (draft carried across accounts, harness printing headers on failure, acceptance implied without version ids, harness accepting any target) → `b55acf9`, `10b0fe4`, `f278391`.
- Admin request list 500 (`2b9d6e7`); no screen for an adult Friend or guardian to accept event documents (`a92ffc6`, `342ac15`, `8b45b4b`); duplicate session-expired message (`a92ffc6`); nav links to routes not built yet (`78f51ca`, `fffe9e4`); AUD-033 anonymous `/cuenta` now a 307 at the request layer (`851e04f`); QA F1/F3/F4/F5 test defects (`6b68f9d`).

Open (none critical or high):

| ID | Severity | Owner | Summary |
| --- | --- | --- | --- |
| H2P2-02 | medium → `OWNER_DECISION_RESOLVED` | owner (OD-P2-01), implementation in Phase 3 | Hold hoarding: one account can hold up to 20 places for 24 h through Guests; the approved policy is in section 6 |
| H2P2-07 | info | owner awareness | the registration context tells the buyer that an accepted Friend/ward is a minor or under 15 (age band only, no date of birth) |
| H2P2-08 | info | frontend | the AUD-033 request-layer redirect matches the literal path; an encoded `/cuenta` variant falls back to the page guard (still authorised by page and DB) |
| H2P2-09 | info | backend | registration-context query cost/locks acceptable for V1 |
| H2P2b-01..03 | info | frontend | harness redaction does not cover worker stdout; any onboarding 409 is treated as completed; sensitive draft answers stay in the owner's own tab storage until sign-out |
| P2-F-03 | info | owner | during P2-A a specialist closed Chrome by image name, which may have closed owner windows (reported at the time; agents now stop only their own PIDs) |
| P2-F-04 | info | owner | a stale, git-ignored `.env.local` with old staging values sits in the workspace, shadowed everywhere; delete it when convenient |
| P2-F-05 | info | — | local tooling: run pgTAP before the local fixture script or after a reset |
| Phase 1 | low/info | various | H2-03..H2-12, P1-F-08/10/11 unchanged (Phase 1 Report section 5) |
| PEND-LEGAL-001/002, PEND-OPS-001 | external | owner | final legal texts and the real WhatsApp number; staging uses QA placeholders; block production only |

## 6. Owner decisions

| Item | State / recommendation |
| --- | --- |
| **OD-P2-01 anti-hoarding (H2P2-02, T11 §6.6, SEC-142)** | **CLOSED — approved by the owner 2026-10-03.** (1) ALTCHA verified server-side before accepting an `EXTERNAL_WHATSAPP` request when the account is younger than 24 h (account age from the server, never the client); (2) an edition-level alert for a suspicious concentration of PENDING requests/holds, through the existing Task Center / operational alert model, threshold from the Master/Roadmap or else a documented, configurable server-side constant; no automatic cancellation; (3) staff bulk cancellation of suspicious PENDING requests: staff-only, auditable, idempotent, capacity released by the source-of-truth state transitions (no mutable `available_slots`); (4) the hold model is unchanged (absolute 24 h, `min(created_at + 24 h, registration close)`, no extension; FREE confirms at once); (5) no CAPTCHA for everyone, accessible errors; (6) no payment gateway. Implemented in the earliest fitting Phase 3 Work Units. |
| Production cutover / OWN-01 | Deferred, separate authorization (unchanged from Phase 1). |
| PEND-LEGAL-001/002, PEND-OPS-001 | External; block production only. |

## 7. Rollback

Production untouched. Staging: re-alias a previous Preview deployment; schema forward-fix by a new migration; QA fixtures are labelled and deletable; the Brevo counter fix is logged with its previous value; the toolbar setting reverts to default.

## 8. Next-phase readiness

Phase 3 was not started. Phase 2 leaves the participant flow complete on staging; staff confirmation of WhatsApp requests exists as an admin API (the full Admin UI belongs to a later phase).

## 9. Owner Human Gate

### Owner Human Gate result (2026-10-03)

`OWNER_DECISION=APPROVE` · no changes requested.

The owner reviewed staging manually and approved: entry into registration from the event, FREE registration, the WhatsApp request with its pending state, 24 h countdown and WhatsApp handoff button, the account request views, passes and QR display, sign-in/session, onboarding and legal acceptance, and the overall participant flow. Staging confirms the review (aggregate, `.salvaops-agent-evidence/P2-GATE/owner-gate-activity.txt`): one FREE registration `CONFIRMED` in `qa-p2-gratis` with its confirmation email `SENT` through Brevo to the allowlisted owner address — this proves the last open sub-item of P2-AC-13 — and one WhatsApp request `PENDING_CONFIRMATION` in `qa-p2-whatsapp` (staff confirmation was not part of the owner's review; it is covered by the E2E journeys and the request expires normally after 24 h).

### Review script used

Review at **https://staging.runiismty.com** (log in to Vercel with the team account when prompted). Two review editions exist only for you: **QA P2 Gratis** (`qa-p2-gratis`, FREE) and **QA P2 WhatsApp** (`qa-p2-whatsapp`, WhatsApp quote; fake staging number). Legal texts are QA placeholders, not legal text. App email reaches only your allowlisted address.

**A. FREE registration (about 5 minutes)**

1. Open `/eventos` → **QA P2 Gratis** → press the registration button.
2. Sign in with your email (6-digit code). Because Terms and Privacy are now recorded per person (OWN-05), you are asked to accept the current versions: both boxes start unticked; accept and you return to the registration.
3. Participants: yourself (you may add a Guest). Choose a modality, fill the form, accept the event documents, submit.
4. Expect: **confirmed at once** — no countdown, no WhatsApp button. Open the pass (or `/cuenta/pases`): a QR is shown.
5. Expect a confirmation email at your address (this is the last open item of P2-AC-13).

**B. WhatsApp registration**

1. Open **QA P2 WhatsApp** → register yourself (10K asks for a category).
2. Expect: **pending** with a reference code, total, a 24-hour countdown from server time, a WhatsApp button (fake number — do not send a real message) and a cancel option. It never says paid.
3. Send the orchestrator the reference code. There is no Admin UI in Phase 2, so the orchestrator confirms it as staff through the admin API.
4. Reload `/cuenta/solicitudes`: the request shows as confirmed, and the pass appears in `/cuenta/pases`.
5. Optional: create a second WhatsApp request and cancel it; it shows as canceled by you and the place is released.

**C. Optional:** repeat A on your phone; open `/cuenta` sections (requests, passes, documents, communications).

**Decide:** `APPROVE` or `REQUEST_CHANGES` for Phase 2. Separately (can wait until before production opening): the hold-hoarding policy H2P2-02 (section 6). Phase 3 does not start without your decision.
