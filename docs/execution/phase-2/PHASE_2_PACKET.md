# RUNIIS — Phase 2 Packet (JIT)

| Field | Value |
| --- | --- |
| phase_id | `P2-PARTICIPANT-EXPERIENCE` |
| phase_name | Complete Participant Experience (Roadmap §8) |
| created | 2026-10-03 by a fresh Phase 2 orchestrator context (built from durable sources only) |
| baseline | `staging@d5ecefd` = `origin/staging` (Phase 1 closed, `OWNER_DECISION=APPROVE`); CI green on the Phase 1 head; T41 isolated at `origin/wip/t41-closure-partial@b34aa74` (not used) |
| authority | Master `docs/RUNIIS_WEB_SYSTEM_MASTER_SPEC_V2.md` > ADR-001/ADR-002 > Roadmap `docs/RUNIIS_EXECUTION_ROADMAP_V1.md` §8 > this packet > Task Envelopes |
| specs | UX `docs/specs/T12-ux-spec.md`, UI `docs/specs/T13-ui-spec.md`, threat model `docs/specs/T11-appsec-threat-model.md` |
| state | checkpoint `.local-state/phase-2/orchestrator-checkpoint.json`, provider log `.local-state/phase-2/provider-ops.log`, envelopes `.local-state/envelopes/P2/`, evidence `.salvaops-agent-evidence/<task_id>/` |
| targets | Vercel Preview `staging` → https://staging.runiismty.com (Vercel Authentication; machines use the automation bypass from the staging Vault); Supabase staging `brxdgvcfykmsqmhsvgxl`. Production untouched (`ALLOW_PRODUCTION_MUTATIONS=false`) |

No secret values appear here. Secrets come only from the orchestrator's private file (orchestrator) and the agents' provider file (single variables, injected only when a Work Unit needs them).

## 1. Goal and observable outcome (Roadmap §8.1–§8.2)

A person goes from discovery to a confirmed registration and a pass without internal tools: open RUNIIS, browse and filter events, open an Event page, sign in, complete onboarding (accepting Terms and Privacy), choose participants, modality and category, answer the event form, see the server-derived price, complete FREE or EXTERNAL_WHATSAPP, understand hold and expiry, see the confirmation, Registration, ParticipantPass and QR, and manage requests and preferences.

## 2. Closed decisions used by this phase

- V1 payment = `FREE` + `EXTERNAL_WHATSAPP` (Master §2–§3, SUP-001, SUP-003, SUP-004). No payment gateway. A WhatsApp request is never shown as paid until staff confirms (§69).
- Hold model = Master: EXTERNAL_WHATSAPP hold is absolute, `expires_at = min(created_at + 24 h, registration_close_at)`, no extension by activity, opening WhatsApp or refreshing; countdown from server time; the effective hold is `ACTIVE AND expires_at > now()` (§63–§64). FREE confirms in one transaction with no hold (§74). **SUP-002 (10-minute inactivity hold) stays superseded — owner decision 2026-10-03.**
- Capacity is derived; no mutable `available_slots` (§35–§37). `TEMPORARILY_UNAVAILABLE` is distinct from `SOLD_OUT` when free capacity is 0 because of holds (§36, §165).
- Request ≠ Registration ≠ Payment (§61, §75, §76); the UI distinguishes REQUEST / HOLD / REGISTRATION (Roadmap §8.10).
- Participant kinds SELF, FRIEND (accepted Friendship), GUEST (owned by the buyer, no community, no credits, no ranking), MINOR 15–17 with an ACTIVE GuardianAssignment; under-15 not allowed; guardian need not register; staff verifies identity/guardian in person; minors not exposed publicly (§19–§25, §65, ADR-001 A10).
- One effective PENDING request per Edition per user; registration request rate limit 5/10 min/user (§179).
- **OWN-05 (owner decision 2026-10-03):** TERMS_OF_SERVICE and PRIVACY_NOTICE are accepted once during onboarding and re-accepted when a newer version is published; event documents (SPORT_WAIVER, EVENT_RULES, MINOR_TERMS) are accepted per registration and per participant; an adult Friend accepts personally (pending actions); the guardian accepts for a minor (§124). Final legal texts remain an external dependency (PEND-LEGAL-001/002); staging uses the currently published versions; no legal text is invented.
- Auth = existing Supabase Auth (Google + 6-digit OTP), HttpOnly session cookies, no browser Supabase client (ADR-001 A8). Pass credentials keep the AES-256-GCM/AAD design (A1–A3).

## 3. Scope

In scope (Roadmap §8.3–§8.21):
- Revalidation on Vercel of inherited F1/F2 surfaces (§8.3) and AUD-033 (anonymous `/cuenta` streaming 200 before redirect).
- Legal acceptance in onboarding + re-acceptance on new versions; registration enforcing applicable acceptances (§8.4).
- `/inscripcion/[slug]` replacing the broken CTA; server-authoritative registration context (Edition, modalities, availability, price, forms, eligibility, required documents) (§8.5–§8.8).
- Participant builder SELF/FRIEND/GUEST/MINOR with invalid combinations prevented and server-revalidated (§8.6, §8.13, §8.14).
- FREE journey to Registration + ParticipantPass + credential + confirmation (§8.9).
- EXTERNAL_WHATSAPP journey: request, hold, absolute `expires_at`, instructions, wa.me handoff, pending state in the account, later staff confirmation (§8.10), expiry handling (§8.11), concurrency (§8.12).
- Participant communications already implemented (confirmations, requests, pass email, reminder confirmation, consent/unsubscribe), validated with safe delivery on staging (§8.15).
- Pass UI (event, participant, status, credential, QR, replacement state) (§8.16).
- UX states, responsive, WCAG 2.2 AA target, keyboard (§8.17–§8.19); security checks (§8.20).
- Staging fixtures (published FREE and EXTERNAL_WHATSAPP editions with capacity, forms and event documents; a staging ADMIN) created through the real commands, clearly marked as QA data.
- E2E participant journeys runnable locally and against staging.

Out of scope (Roadmap §8.26 and later phases): full Admin UI, scanner, closure/T41, rankings, avatar/moderation, sanctions, full Task Center, payment gateways, production schema migration, DNS cutover, Netlify retirement, PostHog/Sentry SDKs (unless a Work Unit proves them required by this gate).

## 4. Open items

| Item | State | Effect |
| --- | --- | --- |
| PEND-LEGAL-001/002 final texts | external | staging uses current published versions; blocks production only |
| PEND-OPS-001 real WhatsApp number | external | staging fixtures use a clearly fake staging number; blocks production only |
| Production cutover / OWN-01 | deferred, separate owner authorization | none for Phase 2 |
| Phase 1 low findings H2-03..H2-12, P1-F-08/10/11 | tracked | pulled in only if they affect the participant flow |

## 5. Work Unit DAG

```
P2-A (frontend: Vercel-capable E2E harness + F1/F2 revalidation suite + AUD-033)
P2-B (backend: OWN-05 legal acceptance + registration context read model + staging fixture script)
        │
        ├──► P2-F (orchestrator: run fixture script on staging, bootstrap staging ADMIN, Vault/env as needed)
        └──► P2-C (frontend: /inscripcion flow — builder, modality/category, forms, legal, summary, FREE + WhatsApp submit)
                    └──► P2-D (frontend: post-submit — confirmation, pending/countdown/wa.me, request detail, pass/QR, onboarding legal UI, account updates)
P2-A + P2-C + P2-D ──► P2-E (frontend: Phase 2 E2E journeys incl. race/expiry/minor/guest/friend/mobile/keyboard)
all ──► P2-H (gate: QA Tier 2 + remote E2E run by orchestrator + targeted AppSec + Integration & Evidence; Human Simulation if journeys need it)
```

| WU | Owner | Depends | Locks |
| --- | --- | --- | --- |
| P2-A | salvaops-frontend | — | repo-write: `tests/e2e/**`, `playwright.config.ts`, `app/cuenta/**` loading/redirect only, `tests/e2e/support/**` |
| P2-B | salvaops-backend | — | repo-write: `lib/server/domain/{registration,auth,people}/**`, `lib/shared/registration.ts`, `app/api/v1/{me,registration-*,events}/**`, `supabase/migrations/<new>`, `supabase/tests/database/<new>`, `scripts/ops/**`; db-schema + db-integration via `scripts/db.mjs` lock |
| P2-C | salvaops-frontend | P2-B contract | repo-write: `app/inscripcion/**`, `components/registration/**`, `components/public/event/**` (CTA only) |
| P2-D | salvaops-frontend | P2-C | repo-write: `app/cuenta/**`, `app/onboarding/**`, `components/account/**`, `components/registration/**` (post-submit) |
| P2-E | salvaops-frontend | P2-A, P2-C, P2-D | repo-write: `tests/e2e/**` |
| P2-F | orchestrator | P2-B | provider-mutation (staging only) |
| P2-H | salvaops-qa, salvaops-appsec, salvaops-integration-evidence (+ salvaops-human-simulation if needed) | all | browser, read-only |

Concurrency: at most two heavy writers; one writer per path; DB mutations only under the `scripts/db.mjs` lock. Push cadence: each accepted Work Unit is committed, secret-scanned, pushed to `staging`, CI observed, Vercel Preview observed, staging migrations applied by the orchestrator when present.

## 6. Acceptance IDs

- P2-AC-01 inherited F1/F2 surfaces revalidated on Vercel (E2E), AUD-033 fixed with regression test.
- P2-AC-02 onboarding records TERMS_OF_SERVICE + PRIVACY_NOTICE acceptance (type, version, actor, accepted_at, context); new version forces re-acceptance; public legal pages resolve current versions.
- P2-AC-03 registration enforces applicable event documents per participant (self, adult Friend via pending actions, guardian for minor).
- P2-AC-04 `/inscripcion/[slug]` works from the Event page CTA; no broken CTA anywhere.
- P2-AC-05 registration context is server-derived (availability, price, forms, eligibility); the server revalidates every submission; stale selections are rejected cleanly.
- P2-AC-06 participant builder supports SELF/FRIEND/GUEST/MINOR and blocks invalid combinations (no guardian, invalid age, duplicate participant, non-accepted Friend, guest not owned).
- P2-AC-07 dynamic forms render from event configuration with field types, required, conditional (when present), accessible labels, error mapping, server validation and input preserved on recoverable errors.
- P2-AC-08 FREE journey ends in Registration + ParticipantPass + credential + confirmation; no Payment and no fake payment state.
- P2-AC-09 EXTERNAL_WHATSAPP journey: request + hold + absolute `expires_at`, instructions, wa.me with only edition + public reference, pending state in the account, cancel; never shown as paid.
- P2-AC-10 expiry: countdown from server time; reload/back/close-reopen; expiry between steps; hold lost; all slots temporarily held → temporarily unavailable; cancellation.
- P2-AC-11 concurrency: last slot with two users, global and modality capacity, hold vs confirmed Registration.
- P2-AC-12 pass UI shows event, participant, status, credential, QR, replacement state; revoked credential never validates.
- P2-AC-13 participant communications validated on staging with allowlist delivery only.
- P2-AC-14 UX states, mobile-first responsive, keyboard, focus, reduced motion, WCAG 2.2 AA on the critical path.
- P2-AC-15 security: server authority, cookies, origin, rate limits, no PII leak, participant/guest/minor/Friend ownership, no cross-account request access; RLS deny-by-default preserved; every new API has auth/authz/validation/rate-limit/idempotency/audit decisions.
- P2-AC-16 staging fixtures exist through real commands and are labelled QA.
- P2-AC-17 E2E journeys of Roadmap §8.22 pass locally and against staging.
- P2-AC-18 CI green on every pushed head; no secrets tracked.
- P2-AC-19 Integration & Evidence READY.

## 7. Testing and Technical Gate

Tier 0/1 inside each Work Unit (unit, schema, route handler, targeted E2E, scoped a11y, targeted security). Tier 2 at the gate: lint, typecheck, unit, pgTAP, integration, build, E2E (3 viewports) locally once on the integrated head; remote E2E against staging executed by the orchestrator (bypass + fixture users injected in its own process); browser console/network clean; axe on the critical path; targeted AppSec; Integration & Evidence. Required journeys (Roadmap §8.22): Adult FREE, Adult WhatsApp, Friend, Guest, Minor, Expired hold, Last slot race, Invalid form, Legal acceptance, Session recovery, Pass display, Credential replacement when exposed, Communication preference, Mobile, Keyboard. Evidence (Roadmap §8.23): registration success, expiry, capacity race, participant type rules, pass issuance, QR state, legal acceptance, permissions, mobile, accessibility.

## 8. Data, migrations, rollback

New SQL only through new migrations with pgTAP; never edit applied migrations; RLS deny-by-default; no secret in SQL. Staging migrations applied by the orchestrator after the push (explicit ref `brxdgvcfykmsqmhsvgxl`, pre-push schema snapshot). Rollback: Vercel keeps previous Preview deployments (re-alias); staging DB forward-fix by migration; QA fixtures deletable/labelled. Production: no change.

## 9. Owner Human Gate (Roadmap §8.24)

The owner opens staging, selects an event, signs in, completes a registration (FREE and WhatsApp), sees the confirmation and the pass. A short manual script is delivered with the Phase 2 Report.
