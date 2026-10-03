# RUNIIS — Phase 3 Packet (JIT)

Internal, machine-facing. Derived at phase start from the Master (`docs/RUNIIS_WEB_SYSTEM_MASTER_SPEC_V2.md`), the Roadmap (`docs/RUNIIS_EXECUTION_ROADMAP_V1.md` §9), the Phase 2 Report (`docs/execution/phase-2/PHASE_2_REPORT.md`, CLOSED — APPROVED_BY_OWNER) and the Git/provider state below. Specialists receive only their Task Envelope.

| Field | Value |
| --- | --- |
| phase_id | `P3-STAFF-OPS-RACEDAY-CLOSURE` |
| baseline | `staging` = `origin/staging@f5727b1` (CI `37148917286` success; Vercel Preview `dpl_5KfJkUjTom2tXMwmPjkEqT4wGUph` READY) |
| staging DB | `brxdgvcfykmsqmhsvgxl`, 73/73 migrations (last `20261003130000_164`) |
| T41 WIP | `origin/wip/t41-closure-partial@b34aa74`: migrations `20260928180000_710`…`180300_713`, pgTAP `710`, `lib/server/domain/closure/{contracts,service}.ts`; task state `.local-state/task-state/T41-attendance-closure-credits.json` |
| production | untouched (`main@bdd1198`); no production mutation in this phase |

## 1. Goal and observable outcome (Roadmap §9.1–§9.2)

RUNIIS staff operate an event end to end without SQL, Postman, the Supabase Dashboard or manual commands: create, configure, publish, manage registrations, handle external (WhatsApp) requests, manage kits, scan, verify guardians, check in, resolve attendance, resolve eligibility, finalize, close (DistanceCredit), and reopen/correct. T41 is completed. Admin and Scanner are real surfaces.

## 2. Closed decisions used by this phase

- Hold model (Master SUP-002): `EXTERNAL_WHATSAPP` absolute 24 h hold `min(created_at + 24 h, registration_close_at)`, no extension; FREE confirms at once. V1 payment = FREE + EXTERNAL_WHATSAPP; no gateway.
- OWN-05: TERMS + PRIVACY in onboarding (+ re-acceptance); event documents per registration and participant.
- **OD-P2-01 anti-hoarding (owner, 2026-10-03)**: (1) ALTCHA verified server-side before accepting an `EXTERNAL_WHATSAPP` request when the account is younger than 24 h (server account age only; missing/invalid/replayed challenge → controlled domain error; no alternate endpoint bypass; FREE and accounts ≥ 24 h unaffected; accessible); (2) edition-level alert for a suspicious concentration of PENDING requests/holds, through the Task Center / operational alert model, threshold from Master/Roadmap or a documented configurable server-side constant; never auto-cancel; (3) staff bulk cancellation of PENDING requests: staff-only, auditable, idempotent, capacity released by source-of-truth transitions, no mutable `available_slots`.
- **OWN-04 cancellation policy (owner, 2026-10-03)**: staff ADMIN/OPERATOR may cancel a CONFIRMED registration at any time until attendance is finalized (before, during or after the event); after finalization or closure only through the audited reopen/correction workflow. Never DELETE; no on-platform refund (external WhatsApp payments are settled outside); pass CANCELED, capacity released while relevant, kit allocation reviewed, credit reversed if any; **the participant is always notified by a transactional email**.
- Staging email: allowlist only; non-allowlisted → `CANCELED / NOT_ALLOWLISTED`, no transport, no retries (migration 164).
- Repository public; Vercel target; T41 reused intentionally, never blindly merged.

## 3. Scope (Roadmap §9.3–§9.29)

T41 recovery (§9.3) and its commands: AttendanceResolution (§9.4), SportingEligibilityResolution (§9.5), attendance universe (§9.6), AttendanceFinalization (§9.7), AdministrativeClosure (§9.8), DistanceCredit ledger exactly-once (§9.9), Reopen (§9.10), Registration cancellation (§9.11, OWN-04), Change modality (§9.12). Admin shell (§9.13), event management (§9.14), readiness UI (§9.15), route editor (§9.16), external request queue (§9.17), participant administration (§9.18), kits (§9.19), scanner (§9.20), guardian desk (§9.21), check-in (§9.22), attendance desk (§9.23), finalization UI (§9.24), closure UI (§9.25), basic Task Center (§9.26: attendance pending, closure pending, communication failure, provider reconciliation, integrity issue; task points to its root object and is never source of truth), RBAC ADMIN/OPERATOR/CHECKIN/MODERATOR (§9.27), operational UX (§9.28), actionable errors (§9.29). Plus OD-P2-01.

Out of scope (§9.36): rankings, achievements, public profiles, avatar moderation, full sanctions, final observability release; production cutover; payment gateway.

## 4. Open items

| Item | State | Effect |
| --- | --- | --- |
| OWN-04 confirmed-registration cancellation policy (Master §77, audit M-GAP-02) | **CLOSED by the owner 2026-10-03** (section 2) | — |
| T41 migration timestamps (`20260928180xxx`) precede staging's applied history | to be renumbered after `20261003130000` (Roadmap §9.3 "decidir si renumerar") | P3-A |
| PEND-LEGAL-001/002, PEND-OPS-001 | external | production only |
| Phase 1/2 low/info findings | tracked | pulled in only where Phase 3 surfaces touch them |

## 5. Work Unit DAG

Two heavy writers at a time (one backend lane, one frontend lane), one optional read-only actor.

```
Backend lane:  P3-A T41 DB recovery (database) ──► P3-C T41 APIs (backend) ──► P3-D anti-hoarding + Task Center + bulk cancel (backend)
Frontend lane: P3-B Admin shell + RBAC nav + error model ──► P3-E event management + readiness ──► P3-F route editor
               ──► P3-H race day: kits, guardian desk, scanner, check-in
               ──► P3-G request queue + participant admin + bulk cancel/alert UI   (needs P3-D)
               ──► P3-I attendance desk, finalization, closure, reopen, cancel/change-modality UI   (needs P3-C)
               ──► P3-J Task Center UI   (needs P3-D)
               ──► P3-K staff E2E journeys + RBAC matrix (local + remote harness)
all ──► P3-GATE (QA Tier 2, targeted AppSec, Integration & Evidence; Human Simulation of the staff cycle if needed)
```

Each UI unit verifies the API it needs exists and reports DISCOVERY instead of editing `lib/server/**`/`app/api/**`/`supabase/**`.

## 6. Acceptance IDs

- P3-AC-01 T41 migrations reconciled (renumbered, no edit of applied migrations), pgTAP 710 fixed, 711 and 712 written, all previous suites green.
- P3-AC-02 attendance resolution/eligibility/finalization/closure/reopen commands and APIs with actor, reason, evidence, audit; check-in is evidence, never final attendance.
- P3-AC-03 DistanceCredit exactly-once (retry/timeout/concurrent close → one effect), official modality distance, Guests never credited, reopen/correction produce auditable history.
- P3-AC-04 registration cancellation per OWN-04 and change modality per Master §78–79 with capacity, pass, kit, attendance, credit effects.
- P3-AC-05 Admin shell: real routes, role-based navigation, backend authorization on every action, no placeholder or broken link.
- P3-AC-06 event management + readiness: staff create/configure/publish an Edition through the UI; invalid publish blocked with missing items shown.
- P3-AC-07 route editor: GPX import within the Vercel body limit, revision, start/finish, POI, validation, publish.
- P3-AC-08 external request queue: list/filter/inspect/confirm/cancel with expiry, hold, participants, WhatsApp state; confirm creates the Registration atomically.
- P3-AC-09 participant administration with PII permissions.
- P3-AC-10 kits workflow; guardian desk with evidence; scanner outcomes (valid, revoked, unknown, wrong Edition, duplicate, already checked in, kit state, minor guardian, network failure/retry, manual fallback); check-in idempotent.
- P3-AC-11 attendance desk, finalization UI, closure UI with readiness and blockers, reopen/correction.
- P3-AC-12 basic Task Center (5 task kinds + OD-P2-01 alert), tasks point to root objects.
- P3-AC-13 OD-P2-01 implemented and tested (ALTCHA <24 h EXTERNAL_WHATSAPP, ≥24 h and FREE unaffected, invalid/replay rejected, no bypass; edition alert; bulk cancel staff-only, idempotent, audited, capacity recomputed).
- P3-AC-14 RBAC matrix ADMIN/OPERATOR/CHECKIN/MODERATOR for UI, direct URL, API, role change, forbidden mutation.
- P3-AC-15 actionable errors (validation, permission, conflict, capacity, stale state, provider, network); no raw SQL/internal error.
- P3-AC-16 operational UX: dense, keyboard where useful, mobile/tablet for race day; WCAG 2.2 AA (axe no serious/critical).
- P3-AC-17 staff E2E journey (§9.30 cycle and negative paths) locally and against staging.
- P3-AC-18 security: targeted AppSec for admin, scanner, PII, RBAC, IDOR, closure commands, guardian evidence, QR validation; no open critical/high.
- P3-AC-19 CI green on every pushed head; no secrets tracked; staging migrations applied.
- P3-AC-20 Integration & Evidence READY.

## 7. Testing and Technical Gate (Roadmap §9.30–§9.33)

Tier 0/1 in each Work Unit. Tier 2 at the gate: lint, typecheck, unit, pgTAP (fresh reset), integration, build, E2E (3 viewports) locally once on the integrated head; remote staff E2E against staging by the orchestrator; Database Gate (T41 pgTAP complete, `close_edition` concurrency, exactly-once credits, reopen/correction, no regressions); Security Gate (§9.32); evidence (§9.33: T41 tests, role boundaries, scanner scenarios, closure lifecycle, DistanceCredit, request queue, kit flow, guardian flow). Full simulation: create Edition → configure → publish → registration → request confirmation → kit → scan → guardian → check-in → attendance → eligibility → finalize → close → DistanceCredit; negative: wrong role, duplicate scan, revoked QR, wrong event, capacity issue, closure blocked, reopen, cancel, change modality.

## 8. Data, migrations, rollback

New SQL only through new migrations with pgTAP; never edit applied migrations; RLS deny-by-default; every privileged command has authentication, authorization, validation, idempotency and audit; no mutable `available_slots`/`total_km`. Staging migrations applied by the orchestrator right after the push of the code that needs them (signature changes: apply then deploy at once). Rollback: previous Preview deployments; forward-fix migrations. Production: no change.

## 9. Owner Human Gate (Roadmap §9.34)

The owner operates a synthetic event as staff on staging (the owner account gets an ADMIN staff role on staging through the admin API) and completes the cycle without internal tools. Result `PHASE_3_APPROVED` or `REQUEST_CHANGES`. A short manual script is delivered with the Phase 3 Report.
