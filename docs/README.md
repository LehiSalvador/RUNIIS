# RUNIIS documentation: authority map

Read this first. It says which document wins when two disagree and where each kind of truth lives.
Updated by Phase 1 `P1-PLATFORM-REBASE` (2026-10-01).

## Precedence (highest first)

1. The owner explicit, most recent decision (recorded in an ADR or the Master, never only in chat or `.local-state/`).
2. **Master** `docs/RUNIIS_WEB_SYSTEM_MASTER_SPEC_V2.md`: functional and technical source of truth for V1 (Master section 1).
3. **ADRs** `docs/adr/` and the approved derived specs `docs/specs/`: how the Master is realised.
4. **Execution Roadmap** `docs/RUNIIS_EXECUTION_ROADMAP_V1.md`: outcomes and phases; cannot override a CLOSED Master rule.
5. **Phase Packet** `docs/execution/phase-<n>/`: the scope of one phase; cannot override the Roadmap.
6. Task Envelopes (`.local-state/envelopes/`, not versioned); agent memory and conversation assumptions never override any of the above.

## Documents

| Path | Role | Status |
| --- | --- | --- |
| `docs/RUNIIS_WEB_SYSTEM_MASTER_SPEC_V2.md` | Master specification V1 | Authority. Patched in Phase 1 (hosting, scheduler, environments, pending items); sections 222-223 are historical |
| `docs/adr/ADR-001-runiis-v1-architecture.md` | Architecture and engineering conventions, Amendment 1 (A1-A10) | Authority; Verified context, decision 10 and Layout `netlify/functions/` are superseded by ADR-002 |
| `docs/adr/ADR-002-platform-vercel-supabase-scheduler.md` | Hosting Vercel, Netlify legacy, scheduler `pg_cron`+`pg_net`, client IP, environment model, ALTCHA, GPX limit, noindex, OTP length, Netlify decommission | Authority |
| `docs/specs/T11-appsec-threat-model.md` | Threat model and `SEC-nnn` requirements cited by code and ADR-001 | Approved derived spec (verbatim copy) |
| `docs/specs/T12-ux-spec.md` | UX specification | Approved derived spec (verbatim copy) |
| `docs/specs/T13-ui-spec.md`, `docs/specs/T13-contrast.txt` | UI specification and its contrast evidence (source name `contrast.log`) | Approved derived spec (verbatim copy) |
| `docs/RUNIIS_EXECUTION_ROADMAP_V1.md` | Execution Roadmap | Plan; replaces Master sections 222-223 as the execution plan |
| `docs/execution/phase-1/PHASE_1_PACKET.md` | Phase 1 scope, owner decisions, risks | Phase control document |
| `docs/runbooks/vercel-cutover-and-rollback.md` | Production cutover and DNS rollback procedure | Operational, prepared and not executed |
| `docs/runbooks/worker-scheduler-vault.md` | Per-environment Vault configuration of the worker scheduler | Operational |
| `docs/audits/` | Master audit, implementation baseline, Netlify-to-Vercel readiness (2026-10-01) | Evidence and inputs, point in time; not authority |
| `docs/RUNIIS_INFRA_SETUP_REPORT.md` | 2026-09-27 infrastructure setup snapshot | Historical, superseded |

## Not authority

- `.local-state/` (git-ignored): orchestration state and envelopes. Decisions found there were migrated to ADR-002; do not use it as durable truth.
- `.salvaops-agent-evidence/` (git-ignored): evidence per Work Unit. The T11/T12/T13 originals live there; the versioned copies are in `docs/specs/` with source and copy hashes.
- `C:\Users\lehi1\Downloads\RUNIIS_WEB_SYSTEM_MASTER_SPEC_V2.md`: pre-reconciliation copy of the Master (R2 wording); historical.
- `00_Documentacion/RUNIIIS_WEB_DOCUMENTO_MAESTRO.md` (local, git-excluded): a pointer to this map, not a specification.

## Using SalvaOps and local agent files

`AGENTS.md` and `CLAUDE.md` (local, git-excluded SalvaOps files) point agents here. Find documentation through
`salvaops context search` and `salvaops context pack`; run `salvaops knowledge index` after adding or rewriting documents.
Privileged operations (git push, Vercel, Supabase, GitHub) go through SalvaOps and need SalvaOps Desktop open; otherwise the
Broker answers `SALVAOPS_BROKER_LOCKED`.

## Rules for changing documents

- Record a durable technical decision in an ADR (new or amended), a product decision as an OWNER_DECISION in the Master, a
  future-phase discovery in the Roadmap. Do not leave durable decisions only in chat or `.local-state/`.
- Update only durable truth: no chronological agent diaries, no pasted code, no prose duplicating tests (Roadmap section 21).
- Superseded content is marked historical with a pointer, not deleted.
- No secret value, token, connection string or private email address in any document. Variables are named, never valued.
