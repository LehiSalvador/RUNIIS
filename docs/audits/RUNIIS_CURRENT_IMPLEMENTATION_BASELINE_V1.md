# RUNIIS — Current Implementation Baseline V1

| Campo | Valor |
| --- | --- |
| Fecha | 2026-10-01 America/Monterrey (2026-10-02 UTC) |
| Ejecutor | Claude principal, sin agentes ni workflow multiagente |
| Pregunta | ¿Dónde está RUNIIS realmente? |
| Documento rector | `RUNIIS_MASTER_AUDIT_REPORT_V1.md` (finding register AUD-001…AUD-043) |

## 1. Respuesta corta

- FACT: RUNIIS V1 está implementado parcialmente, solo en el disco local (`C:\PROYECTOS_CLAUDE\RUNIIIS WEB`, rama `staging`, 21 commits V1 no publicados + WIP T41 sin seguimiento).
- FACT: ninguna URL pública ejecuta V1. `runiismty.com` (Netlify, `main@bdd1198`), `staging--runiis-web.netlify.app` (`staging@89b79d4`) y `runiis-web.vercel.app` (`main@bdd1198`) sirven el placeholder "RUNIIS WEB infrastructure ready".
- FACT (gates locales): typecheck, lint, unit 463/463, build, integración 60/60 y E2E 229 pass/17 skip pasan; pgTAP falla solo por el test WIP de T41.
- Construido y verificado localmente: fundaciones, esquema físico completo (82 tablas `app`), RLS/RBAC, auth OTP/sesiones, onboarding y área de cuenta, eventos/ediciones/modalidades/capacidad/precios (API), rutas/GPX (API), discovery público + SEO, Friends/Guests/guardianes, solicitudes de inscripción/holds/confirmación/FREE (API), pases QR cifrados, comunicaciones con dispatcher y adaptador Brevo, Race Day backend (scan, check-in, guardian desk, kits, lookup), remediación AppSec-R1.
- No construido: UI de inscripción, panel admin, scanner, cierre post-evento operable (T41 parcial), rankings/logros/perfil público, avatar/moderación/sanciones, Task Center, observabilidad, CI, despliegue V1.

## 2. Git baseline

| Elemento | Valor (FACT) |
| --- | --- |
| cwd | `C:\PROYECTOS_CLAUDE\RUNIIIS WEB` |
| Remote | `origin https://github.com/LehiSalvador/RUNIIS.git` (público, ramas sin protección) |
| Rama actual | `staging` |
| base_commit (HEAD) | `a9ef303d36e1ec91eaf0fbffc579d84b2bda5b6c` — "feat(account): add sign-in, onboarding and the account area" (2026-09-28) |
| `main` / `origin/main` | `bdd1198` (2026-09-27, "docs: complete secure Vercel token rotation") |
| `origin/staging` | `89b79d4` (2026-09-26, "fix: enable Netlify Next runtime") |
| Divergencia | `origin/main...origin/staging` = 16/0; `main..staging` = 21; `origin/staging..staging` = 37 |
| Tags / stash | Ninguno / vacío |
| Commits totales | 47 en `staging`, 26 en `main` |

## 3. Branches y relación con remoto

- `main`: bootstrap de infraestructura + documentación de infra; publicado; desplegado en Netlify producción y Vercel producción.
- `staging` local: `main` + 21 commits V1 (`a2a9638` … `a9ef303`). No publicado. `origin/staging` se quedó en el estado de recuperación de Netlify (`89b79d4`) y no contiene ni los 16 commits documentales de `main`.
- Riesgo: copia única (AUD-003). SalvaOps Code Ledger vacío (`ledger.present=false`, ningún `history capture`).

## 4. Working tree

| Ruta | Estado | Naturaleza |
| --- | --- | --- |
| `next-env.d.ts` | Modificado | Artefacto de `next dev` (`./.next/dev/types/*`). No es cambio de producto (AUD-041) |
| `lib/server/domain/closure/` (`contracts.ts` 144 l, `service.ts` 128 l) | Sin seguimiento | T41 WIP; no referenciado por ninguna ruta |
| `supabase/migrations/20260928180000_710_closure_kernel.sql` (333 l) | Sin seguimiento | T41 WIP |
| `supabase/migrations/20260928180100_711_attendance_commands.sql` (318 l) | Sin seguimiento | T41 WIP |
| `supabase/migrations/20260928180200_712_closure_commands.sql` (227 l) | Sin seguimiento | T41 WIP |
| `supabase/migrations/20260928180300_713_registration_cancel_change_modality.sql` (265 l) | Sin seguimiento | T41 WIP |
| `supabase/tests/database/710_closure_attendance_lifecycle.test.sql` (196 l) | Sin seguimiento | T41 WIP; falla (AUD-009) |

Archivos ignorados relevantes (no evaluados como cambios): `.env.local`, `.env.development.local`, `.env.production.local` (contienen secretos locales; no abiertos), `.local-state/`, `.salvaops-agent-evidence/`, `.netlify/`, `.next/`, `playwright-report/`, `test-results/`. `AGENTS.md`, `CLAUDE.md`, `00_Documentacion/`, `80_Temporal/` excluidos vía `.git/info/exclude`.

Protección del baseline durante la auditoría: hashes de `next-env.d.ts` y de los 7 archivos T41 registrados antes de los diagnósticos y re-verificados después (todos OK); `git status --porcelain` idéntico antes y después. Efectos fuera del repo: la DB Supabase local recibió fixtures de integración/E2E; Docker Desktop y un dev server `:3100` se iniciaron y se detuvieron al terminar.

## 5. Reconciliación de la campaña anterior

Fuentes: `git log`, `.local-state/RUNIIS_ORCHESTRATION_STATE.json`, `.local-state/task-state/*.json`, `.local-state/envelopes/*.md`, `.salvaops-agent-evidence/*`. Los IDs son históricos; no son fases del nuevo roadmap.

| ID | Objetivo | Commit(s) | Checkpoint / envelope | Evidencia | Estado reconciliado | Pendiente relevante |
| --- | --- | --- | --- | --- | --- | --- |
| T00 | Tooling, Supabase local, ADR-001 | `a2a9638` | — | — | DONE, integrado | — |
| T10 | Esquema físico V1 (001–029) | `6ff7a01` | — | `T10-db-foundation/` (reset, rollback, concurrencia, planes) | DONE, integrado; pgTAP 010–040 verdes hoy | — |
| T11 | Threat model AppSec | — (doc) | — | `T11-appsec-threat-model/threat-model.md` | DONE; decisiones en ADR-001 A1–A10 (`af34ae8`) | Documento solo en carpeta ignorada (AUD-025) |
| T12 | UX spec | — (doc) | — | `T12-ux-spec/ux-spec.md` | DONE (v1 con forks fabricados descartada; reanudada) | Igual |
| T13 | UI spec | — (doc) | — | `T13-ui-spec/ui-spec.md`, `contrast.log` | DONE (tras interrupción por uso) | Igual |
| T14 | Backend foundation (HTTP, envelope, errores, idempotencia, workers) | `5e8947b` | — | `T14-backend-foundation/` | DONE, integrado | — |
| T15 | Design system, shells, harness E2E | `4390562` | envelope | `T15-frontend-foundation/` | DONE (parcial F1 derivado a T20 y resuelto) | Revisión independiente nunca hecha |
| T20 | Identidad, RLS/RBAC, sesión, proxy | `0eef920` | envelope + task-state DONE | `T20-auth-rls/` | DONE, integrado; pgTAP 100/110/120/130/136 verdes | T20-F2 (IP Netlify) → AUD-004 |
| T20b | Aceptación legal en onboarding + contexto de inscripción | — | Solo citado en `next_node`/`findings_open` | — | NUNCA INICIADO | F2-F1, F2-F3, F3-precheck (AUD-018) |
| T30 | Dominio Event/Edition/config + API admin | `dc1aa3e`, `ab26b30` | envelope + task-state DONE | `T30-events-admin/` | DONE, integrado; pgTAP 200–204 verdes | T30-F1 seeds legales E2E |
| T31 | Discovery read side | `8fabcf2` | envelope + task-state DONE | `T31-discovery-queries/` | DONE, integrado | — |
| T31b | Fixes discovery (distancia, media, lecturas públicas) | `73fdd16` | envelope + task-state DONE | `T31b-discovery-fixes/` | DONE, integrado | — |
| T31c | Invalidación de cache | `1c2edc0` | sin envelope (agente T31b reanudado) | `T31c-cache-invalidation/` | DONE, integrado | — |
| T32 | Rutas, GPX endurecido, proyecciones | `44e1d35` | envelope + task-state DONE | validación combinada `ORCH-validation-20260928/` | DONE, integrado; pgTAP 260/261 verdes | Editor de rutas UI no existe |
| T33 | Friends, búsqueda, Guests, guardianes | `f2c4aab` | envelope + task-state DONE | `T33-people/` | DONE, integrado | — |
| T34 | Requests, holds, claims, confirmación, pases, credenciales | `da331a3` | envelope + task-state DONE | `T34-registration-passes/` | DONE, integrado; pgTAP 400/410 verdes | UI F3 |
| T35 | Comunicaciones, dispatcher, Brevo | `6ced27b` | envelope + task-state DONE | `T35-communications/` | DONE, integrado; pgTAP 500–502 verdes | Webhook Brevo no registrado; `EMAIL_DELIVERY_MODE` sin configurar en hosts |
| T36 | Avatar, Cloudinary upload, sanciones | — | PENDING (sin envelope) | — | NO INICIADO | Todo |
| T40 | Race Day: scan, check-in, guardian desk, kits, lookup | `3c965e5` | envelope + task-state DONE | `T40-raceday/` | DONE, integrado; pgTAP 600/601 verdes | Scanner UI F5 |
| T41 | Asistencia, elegibilidad, finalización, cierre, créditos, cancel/change modality | — (sin commit) | envelope + task-state `IN_PROGRESS` 2026-09-28T23:10Z; orquestador "CHECKPOINTING (usage limit)" | Sin carpeta de evidencia | `T41_PARTIAL` (§6) | Ver §6 |
| T42 | Rankings, snapshots, achievements, perfil público | — | PENDING | — | NO INICIADO | Todo |
| T43 | Task Center, integridad, observabilidad | — | PENDING | — | NO INICIADO | Todo |
| F1 | Páginas públicas + SEO | `a9195f4` | envelope + task-state PASS | `F1-public-seo/` | DONE, integrado; E2E public verde hoy | `/ranking`, `/personas/{id}` dependen de T42 |
| F2 | Sign-in, onboarding, área de cuenta | `a9ef303` | envelope + task-state PASS | `F2-account/` | DONE, integrado; E2E account verde hoy | F2-F1…F2-F5 (AUD-018, AUD-033) |
| F3 | UI de inscripción | — | PENDING | — | NO INICIADO | CTA rota a `/inscripcion/{slug}` |
| F4 | Admin UI | — | PENDING | — | NO INICIADO | — |
| F5 | Scanner UI | — | PENDING | — | NO INICIADO | — |
| AppSec-R1 | Revisión AppSec dirigida | — | DONE (0 crit/high, 1 med, 8 low, 1 info) | `AppSec-R1/findings.md` | DONE | Residuales: §AUD-031 |
| SEC-FIX-1 | Remediación F1–F10 AppSec-R1 + SEC-064 | `2d06539` | envelope + task-state DONE | `SEC-FIX-1/` | DONE, integrado; pgTAP 503 verde | Re-verificación independiente pendiente (AUD-020) |
| V1–V4, D1 | QA E2E, AppSec final, deploy, I&E, human simulation | — | PENDING | — | NO INICIADOS | — |

Notas: `77bbc43` (lock DB reentrante) y `a15735f`/`af34ae8` (ADR) son commits de soporte. El orquestador agotó uso dos veces (2026-09-27 ~15:00 y 2026-09-28) y el estado `RUNIIS_ORCHESTRATION_STATE.json` quedó desactualizado (AUD-025).

## 6. Conclusión T41

**Clasificación: `T41_PARTIAL`.**

Evidencia:

| Aspecto | Hallazgo (FACT) |
| --- | --- |
| Commits | Ninguno. `last_safe_commit` del checkpoint = `2d06539` |
| Handoff | No existe; checkpoint `IN_PROGRESS` con lista `remaining` de 12 ítems |
| Migraciones | 4 archivos sin seguimiento aplicados en la DB local (`schema_migrations` local contiene `20260928180000..180300`) |
| Código TS | `closure/contracts.ts` y `closure/service.ts` existen; ninguna ruta los importa |
| Rutas API Master §175/§172 | Ninguna de las 9 previstas existe (`/admin/editions/:id/attendance`, `/finalize`, `/reopen`, `/close`, `/reopen`, `/registrations/:id/attendance/resolve`, `/sporting-eligibility/resolve`, `/cancel`, `/change-modality`) |
| Tests pgTAP | `710` escrito; ejecutado hoy: aborta en línea 135 (`text ->> unknown`), 10/24 aserciones ejecutadas y aprobadas antes del error. `711` (créditos) y `712` (cancel/change) no escritos |
| Integración | `tests/integration/closure/` no existe |
| Lint/typecheck | Los archivos TS T41 pasan lint y typecheck |
| Suite previa | Las 32 suites pgTAP previas siguen verdes con las 4 migraciones aplicadas (1007 aserciones), coherente con el checkpoint |
| Evidencia | `.salvaops-agent-evidence/T41-attendance-closure-credits/` no existe |
| Seed opcional | `supabase/seeds/70_closure.sql` no existe |

Valor conservable: el diseño SQL de asistencia/cierre/créditos (idempotencia `ON CONFLICT … WHERE status='ACTIVE'`, bootstrap de `ranking_epoch`, `CLOSURE_BLOCKED`) y los contratos zod. Estado reanudable: corregir 710, escribir 711/712, rutas, integración (incluida concurrencia de `close_edition`), evidencia. Considerar renumeración de timestamps (AUD-026).

## 7. Matriz de implementación por dominio (Master → implementación)

Leyenda de `implementation_status`: VERIFIED_IMPLEMENTED (evidencia de test ejecutado hoy), IMPLEMENTED_UNVERIFIED, PARTIAL, NOT_IMPLEMENTED, BROKEN, BLOCKED_EXTERNAL, UNKNOWN. `decision_status`: CLOSED salvo indicación.

| # | Requisito | Master | Decisión | Implementación | Refs | Tests / evidencia | Findings | Acción roadmap |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Tooling y Supabase local | §223.1–2 | CLOSED | VERIFIED_IMPLEMENTED | `scripts/db.mjs`, `supabase/config.toml` | lint/type/build PASS | AUD-034 | Preservar |
| 2 | Esquema físico, constraints, índices | §12–§14, §161–§163 | CLOSED | VERIFIED_IMPLEMENTED | migraciones 001–029 | pgTAP 010–040 PASS | — | Preservar |
| 3 | RLS, helpers, grants, column security | §156–§160 | CLOSED | VERIFIED_IMPLEMENTED | 024, 025, 029, 700 | pgTAP 100/110/120/503 PASS | AUD-020 | Re-verificar en AppSec final |
| 4 | Auth OTP, sesiones, hook blocked identity | §15, §17, §122 | CLOSED | VERIFIED_IMPLEMENTED (local) | `lib/server/domain/auth`, `proxy.ts`, 027 | pgTAP 130; integración auth; E2E sign-in | AUD-004, AUD-019 | Verificar config Auth remota |
| 5 | Google OAuth | §17 | CLOSED | IMPLEMENTED_UNVERIFIED | `/api/v1/auth/google`, `/auth/callback` | No ejercitable local (F2-F4) | AUD-023 | Smoke en Preview |
| 6 | Onboarding y perfil | §16, §18, §160 | CLOSED | VERIFIED_IMPLEMENTED (sin aceptación legal) | 040, 041, `/onboarding`, `/cuenta/perfil` | pgTAP 136; E2E account | AUD-018 | Completar aceptación legal |
| 7 | Staff y roles | §144–§145 | CLOSED | VERIFIED_IMPLEMENTED (API) | 042, `/api/v1/admin/staff` | pgTAP 136 | — | UI admin |
| 8 | Friends y People search | §22–§23 | CLOSED | VERIFIED_IMPLEMENTED | 131, 132, `/cuenta/amigos` | pgTAP 310/320; integración; E2E | — | Preservar |
| 9 | Guests y archivo | §24–§25 | CLOSED | VERIFIED_IMPLEMENTED | 133 (+ pg_cron `archive-guests`) | pgTAP 330; E2E | — | Preservar |
| 10 | Menores y guardianes | §19–§21 | CLOSED (A10) | VERIFIED_IMPLEMENTED | 134, 601 | pgTAP 340/601; E2E | — | Preservar |
| 11 | Event/Edition/schedule/transiciones | §26–§33, §169 | CLOSED | VERIFIED_IMPLEMENTED (API); UI NOT_IMPLEMENTED | 300–305 | pgTAP 200–204; integración events | AUD-007 | Admin UI |
| 12 | Modality, capacity, availability, price, category, forms | §34–§42 | CLOSED | VERIFIED_IMPLEMENTED (API) | 300, 302, 140 | pgTAP 200/202/400; concurrencia | AUD-027 | Admin UI |
| 13 | Locations, agenda, content blocks | §43–§44, §51 | CLOSED | VERIFIED_IMPLEMENTED (API) | 302 | pgTAP 202 | — | Admin UI |
| 14 | Event media asset (upload) | §52 | CLOSED | NOT_IMPLEMENTED (solo lectura de URL Cloudinary) | `lib/shared/media-url.ts` | — | AUD-008 | Con avatar/Cloudinary |
| 15 | Routes, revisions, POI, GPX, validación | §45–§50, §170 | CLOSED | VERIFIED_IMPLEMENTED (API); editor UI NOT_IMPLEMENTED | 320, 321, `gpx-parser.ts` | pgTAP 260/261; integración routes | AUD-015 | Editor UI |
| 16 | Discovery, búsqueda, filtros, Event page, SEO, cache | §53–§60, §165 | CLOSED | VERIFIED_IMPLEMENTED (eventos); PARTIAL (`/ranking`, `/personas` ausentes) | 310–312, `app/(public)`, `sitemap.ts`, `robots.ts`, `og/` | pgTAP 250–252; E2E public | AUD-007 | Completar con comunidad |
| 17 | Registration requests, holds, claims, WhatsApp, FREE, confirm, revalidate, cancel request | §61–§76, §167, §171 | CLOSED | VERIFIED_IMPLEMENTED (API + vista de solicitudes en cuenta); UI de inscripción NOT_IMPLEMENTED | 140–145 | pgTAP 400/410; integración registration + concurrency | AUD-007 | UI inscripción |
| 18 | Cancel registration, change modality, revision | §77–§79, §172 | OWNER_DECISION (política) | PARTIAL (713 sin seguimiento, sin API, sin tests) | 713 | — | AUD-008, AUD-009 | Reanudar T41 |
| 19 | Pass, credential, QR, replacement, access | §80–§84, §168 | CLOSED (A1–A3) | VERIFIED_IMPLEMENTED | 143, `pass-credential.ts` (AAD + hash) | pgTAP 410; integración; E2E pases | — | Preservar |
| 20 | Scan, check-in, guardian desk, kits, lookup | §85–§90, §174 | CLOSED | VERIFIED_IMPLEMENTED (API); scanner UI NOT_IMPLEMENTED | 600–603 | pgTAP 600/601; integración raceday | AUD-007 | Scanner UI |
| 21 | Attendance resolution, eligibility, universe, finalization | §91–§94, §175 | CLOSED | PARTIAL | 710, 711 (sin seguimiento) | pgTAP 710: 10/24 antes de abortar | AUD-009 | Reanudar T41 |
| 22 | Closure, protocol, reopen, DistanceCredit, sport_date, epoch | §95–§102 | CLOSED | IMPLEMENTED_UNVERIFIED (SQL sin tests) | 712 (sin seguimiento) | ninguno | AUD-008 | Reanudar T41 |
| 23 | Ranking periods, projection, snapshots, historical cut | §103–§109, §153 | CLOSED | NOT_IMPLEMENTED (tablas 018) | 018 | — | AUD-008 | Bloque comunidad |
| 24 | Achievements | §110–§112 | CLOSED | NOT_IMPLEMENTED (tablas + seeds 028) | 018, 028 | — | AUD-008 | Bloque comunidad |
| 25 | Home community y perfil público | §113–§114 | CLOSED | NOT_IMPLEMENTED (slot de Home condicionado; sin `/personas`) | `app/(public)/page.tsx:245` | — | AUD-008 | Bloque comunidad |
| 26 | Avatar, Cloudinary, moderación | §115–§118, §173 | CLOSED | NOT_IMPLEMENTED (tablas 019) | 019 | — | AUD-008 | Bloque comunidad |
| 27 | Sanciones, identity lock, ban/unban | §119–§121, §177 | CLOSED / AMBIGUOUS §121 | PARTIAL (estados de cuenta y triggers de identidad; sin commands ni API) | 005, 027, `restricted-account.tsx` | E2E estado restringido | AUD-008 | Bloque moderación |
| 28 | Legal documents y aceptación | §123–§124 | CLOSED / OWNER_DECISION onboarding | PARTIAL | 303, `/api/v1/admin/legal`, `/legal/*` | pgTAP 203; E2E static | AUD-018 | Completar |
| 29 | Comunicaciones (consent, reminders, templates, campaigns, dispatch, provider events, suppression, quota) | §125–§141, §176 | CLOSED | VERIFIED_IMPLEMENTED (local, modo capture/Mailpit); proveedor real UNVERIFIED | 150–156, `lib/server/domain/communications`, `providers/email` | pgTAP 500–503; integración; E2E | AUD-006, AUD-022, AUD-031 | Verificación Brevo real |
| 30 | Task Center | §142–§143, §228 | CLOSED | NOT_IMPLEMENTED (tabla + helper `comms_open_admin_task`) | 022 | — | AUD-008 | Bloque operación |
| 31 | Audit, outbox, idempotencia, worker run | §146–§150 | CLOSED | VERIFIED_IMPLEMENTED | 023, `lib/server/workers/outbox` | pgTAP 501; unit backoff | — | Preservar |
| 32 | Workers | §152 | CLOSED (frecuencias) / OPEN (mecanismo) | PARTIAL: 7 de 13 implementados; 3 en `pg_cron`, 4 vía Netlify (inactivos en remoto) | 145, 305, 133, `netlify/functions` | — | AUD-002, AUD-038 | Scheduler Vercel |
| 33 | Integrity cases | §154 | CLOSED | NOT_IMPLEMENTED (tabla + value-sets en 710 WIP) | 018, 710 | — | AUD-008 | Bloque comunidad |
| 34 | Platform settings | §155 | CLOSED | VERIFIED_IMPLEMENTED | 303 | pgTAP 203 | — | Preservar |
| 35 | API conventions, errores, rate limits | §164, §178–§179 | CLOSED | VERIFIED_IMPLEMENTED | `lib/server/http/*` | unit | AUD-004 | Ajuste IP por plataforma |
| 36 | Seguridad web (CSP nonce/pública, headers, cookies, ALTCHA, CSP report) | §208, ADR A8–A9 | CLOSED / IMPL_FLEXIBLE (ALTCHA) | VERIFIED_IMPLEMENTED (local) | `proxy.ts`, `next.config.ts`, `/api/csp-report` | E2E CSP; unit | AUD-020 | AppSec final en host real |
| 37 | UI foundations, design system, shells | §181–§191, §228 | CLOSED | VERIFIED_IMPLEMENTED (base) | `components/ui`, `components/shell`, `/design-system` | E2E foundation; T15 perf | — | Preservar |
| 38 | Admin surfaces | §228 | CLOSED | NOT_IMPLEMENTED | `app/admin/layout.tsx` placeholder | — | AUD-007 | Bloque admin |
| 39 | Analytics | §198 | CLOSED | NOT_IMPLEMENTED | — | — | AUD-017 | Pre-producción |
| 40 | Observabilidad | §197 | CLOSED | NOT_IMPLEMENTED (solo `logEvent` JSON) | `lib/server/log.ts` | — | AUD-017 | Pre-producción |
| 41 | Backup y recuperación | §196 | OWNER_DECISION | NOT_IMPLEMENTED | — | — | AUD-024 | Gate producción |
| 42 | Load/concurrency (k6) | §209 | CLOSED | NOT_IMPLEMENTED (concurrencia DB sí: `T10` race, integración concurrency) | — | — | AUD-032 | Gate producción |
| 43 | CI | §10 | CLOSED | NOT_IMPLEMENTED | — | — | AUD-016 | Plataforma |
| 44 | Despliegue V1 y migración de DB productiva | §218 | CLOSED | NOT_IMPLEMENTED | — | — | AUD-019 | Gate producción |

## 8. Tests y evidencia

### 8.1 Ejecución de esta auditoría (baseline `a9ef303` + WIP)

| Suite | Resultado | Duración |
| --- | --- | --- |
| typecheck | PASS | 5 s (incremental) |
| lint | PASS | 39 s |
| unit (46 archivos) | 463/463 PASS | 9 s |
| build Next 16.3.6 | PASS | 23 s |
| pgTAP (33 archivos) | FAIL: 32 OK, `710` aborta (10/24) | 12 s |
| integración (10 archivos) | 60/60 PASS | — |
| E2E Playwright (11 specs × 3 viewports) | 229 PASS, 17 SKIP, 0 FAIL | 4.5 min |
| gitleaks historia / árbol | Sin secretos rastreados (placeholder `.env.example`) | — |

Inventario de tests: 46 unit, 10 integración (+ helpers), 33 pgTAP (32 rastreados), 11 E2E, 0 load, 0 integración de cierre.

### 8.2 Ledger histórico (no sustituye 8.1)

Validaciones registradas por el orquestador sobre SHAs anteriores: pgTAP 170 → 780 → 839 → 991 → 1007 aserciones; unit 148 → 463; integración 5 → 60; E2E foundation 81 pass/3 skip, public 103 pass/14 skip. Carpetas `.salvaops-agent-evidence/*` corresponden a SHAs previos al baseline; útiles como historia, no como prueba del estado actual.

## 9. Comportamiento roto conocido (BROKEN)

1. pgTAP `710_closure_attendance_lifecycle` (WIP T41) — error SQL en línea 135 (AUD-009).
2. CTA "Inscribirme" de la página de evento → `/inscripcion/{slug}` 404 (AUD-007).
3. `/admin` y `/scanner` → 404 (solo layouts placeholder; los enlaces a `/admin` existen únicamente dentro de `AdminShell`, que ninguna página monta) (AUD-007).
4. `/api/health` en Vercel producción reporta `staging` (AUD-028).
5. Proyecto Vercel con código V1 respondería 500 en todas las rutas por `APP_ENV` ausente (inferencia directa de `lib/server/env.ts` + `proxy.ts`; AUD-005).

## 10. Comportamiento no verificado (UNVERIFIED)

- Google OAuth extremo a extremo (local deshabilitado; remoto sin smoke V1).
- Brevo envío real, webhook autenticado real, cuota real y política de IPs autorizadas (AUD-006, AUD-022).
- Cloudinary con código V1 (no hay upload implementado; smoke de infra 2026-09-27).
- PostHog y Sentry (sin SDK).
- Configuración Auth del Supabase productivo y estado de sus migraciones (AUD-019).
- CSP y headers sobre un host real (Netlify o Vercel) con código V1.
- Workers HTTP disparados por scheduler remoto (nunca ejecutados en remoto; AUD-038).
- Rendimiento §191 sobre host real (solo una medición local T15).

## 11. Deuda del workflow anterior

| Elemento | Clasificación | Motivo |
| --- | --- | --- |
| `.local-state/RUNIIS_ORCHESTRATION_STATE.json` | RECONCILE → OBSOLETE | Contiene decisiones (env model, ALTCHA, scheduler policy, provider facts Brevo) que deben pasar a ADR; gates/estados stale (AUD-025) |
| `.local-state/RUNIIS_USAGE_EFFICIENCY.json` | OBSOLETE | Telemetría de la sesión anterior |
| `.local-state/RUNIIS_INFRA_SETUP_STATE.json` | KEEP (histórico) | Contradicciones registradas en AUD-037 |
| `.local-state/envelopes/*.md` (15) | OBSOLETE como artefactos de ejecución; T41 → RECONCILE | El nuevo workflow genera sus propios Task Envelopes; el envelope T41 conserva la lista de aceptación útil |
| `.local-state/task-state/T41-*.json` | RECONCILE | Checkpoint preciso y reanudable |
| `.local-state/task-state/*` (resto) | OBSOLETE | Superados por commits |
| `.local-state/gitleaks-*.json` (4) | REMOVE_LATER | Escaneos antiguos |
| `.local-state/db.lock` | — | No presente (lock liberado) |
| `.salvaops-agent-evidence/T11`, `T12`, `T13` (threat model, UX spec, UI spec) | RECONCILE | Especificaciones durables citadas por código/ADR, hoy sin versionar |
| `.salvaops-agent-evidence/*` (resto) | KEEP (histórico) | Ligado a SHAs anteriores; no es evidencia del baseline |
| Archivos T41 sin seguimiento | RECONCILE | Reanudar T41; no descartar |
| `next-env.d.ts` modificado | REMOVE_LATER | Revertir al contenido de HEAD antes de commitear |
| `playwright-report/`, `test-results/`, `tsconfig.tsbuildinfo` | REMOVE_LATER | Artefactos ignorados |
| `.netlify/`, `netlify/functions/`, `netlify.toml`, `@netlify/functions`, `@netlify/plugin-nextjs` | REMOVE_AFTER_MIGRATION | Ver migration readiness §5 |
| `00_Documentacion/RUNIIIS_WEB_DOCUMENTO_MAESTRO.md` y carpetas `10_…80_` vacías | RECONCILE | Estructura SalvaOps vs código en raíz; `AGENTS.md` desalineado (AUD-014) |
| `scripts/ops/bootstrap-admin.mjs` | KEEP | Bootstrap one-shot del primer ADMIN; requiere ejecución autorizada |
| `C:\Users\lehi1\Downloads\RUNIIS_WEB_SYSTEM_MASTER_SPEC_V2.md` | OBSOLETE | Pre-reconciliación |
| `C:\Users\lehi1\OneDrive\Documentos\RUNIIS_WORKSPACE_CORRECTION_BACKUP_20260926-221732` | UNKNOWN | Backup fuera del repo; decisión del owner |
| Tokens antiguos preservados (Vercel amplio y Supabase legacy, según infra report) | REMOVE_LATER | Higiene de credenciales; requiere owner |
| Supabase remoto staging `brxdgvcfykmsqmhsvgxl` | UNKNOWN | No autoritativo; candidato a backend de Preview (OPEN-02) |
| TODO/FIXME en código | KEEP | 3 ocurrencias, sin deuda material |
| Ramas obsoletas | — | No existen ramas adicionales |
| Migraciones duplicadas | — | No detectadas |

## 12. Topología actual de infraestructura (CURRENT_REALITY)

| Componente | Estado (FACT salvo indicación) |
| --- | --- |
| GitHub | `LehiSalvador/RUNIIS`, público, `main` y `staging` sin protección, sin Actions. SalvaOps binding CONNECTED, health NOT_CONFIGURED |
| Netlify | Sitio `runiis-web` (`129537db-751a-4828-9651-3cd93fef4c37`), cuenta `runiis-platform` (tipo Free), Node 24, región functions `us-east-2`, allowed branches `main`,`staging`; producción publicada `main@bdd1198` (deploy `6ab8becd…`, 2026-09-27); custom domain `runiismty.com`, `force_ssl`; deploy hook presente |
| Vercel | Proyecto `runiis-web` (`prj_8cMyzcQpzyJUd286AQ5DmpN2fHZE`), team `lehisalvadors-projects` plan Hobby; Git `LehiSalvador/RUNIIS`, production branch `main`; Node 24.x; Fluid compute, región `iad1`; 4 deployments de producción (2026-09-27, último `bdd1198`); dominios `runiismty.com` (308 → www), `www.runiismty.com`, `runiis-web.vercel.app`; 24 env vars sensibles production+preview; crons habilitados sin definiciones; Vercel Authentication `all_except_custom_domains` |
| Dominio/DNS | `runiismty.com` registrado en Vercel (2026-09-24, expira 2027-09-24, `renew: false`), nameservers `ns1/ns2.vercel-dns.com`. Apex `A 75.2.60.5` (Netlify, manual, prevalece sobre `ALIAS` de sistema), `www CNAME runiis-web.netlify.app`, `ALIAS *` → Vercel, Brevo (`brevo-code` TXT, DKIM `brevo1/brevo2`, DMARC `p=none`), CAA letsencrypt/sectigo/pki.goog. Certificado Vercel `*.runiismty.com` + apex vigente hasta 2026-12-23 con auto-renew |
| Supabase local | Proyecto `RUNIIIS_WEB` Docker (API 54621, DB 54622, Mailpit 54624); 70 migraciones aplicadas (66 rastreadas + 4 T41); jobs `pg_cron`: `close-registration-windows` */5, `expire-registration-requests` */5, `archive-guests` 09:15 UTC |
| Supabase producción | `mdzhsoeqagtwznybwtuy` (`runiis-web-prod`, us-east-1); SalvaOps binding CONNECTED (health 2026-09-27); estado de esquema y Auth UNKNOWN |
| Supabase staging remoto | `brxdgvcfykmsqmhsvgxl`; no autoritativo; CLI local enlazado a él pero `Unauthorized` |
| Brevo | Free (dato 2026-09-28: 300/día); dominio autenticado; SMTP para OTP Supabase; webhook no registrado (pendiente orquestador) |
| Cloudinary | Smoke de infra OK 2026-09-27 (upload firmado, WebP 512, limpieza); sin código de upload |
| PostHog / Sentry | Proyectos existentes con smoke de infra; sin SDK en la app |
| Google OAuth | Clientes staging/producción configurados en Supabase (infra report); no verificable hoy |
| Workers | 3 en `pg_cron` (local; remoto UNKNOWN); 4 HTTP vía Netlify Scheduled Functions, inactivos en remoto (AUD-038) |
| SalvaOps | Broker 1.3.1; Desktop cerrado → capacidades de proveedor UNAVAILABLE; índice con 3 documentos; ledger vacío |

## 13. Estado de proveedores

| Proveedor | Evidencia | Estado |
| --- | --- | --- |
| GitHub | API pública read-only | PRESENT, público |
| Netlify | `netlify status`, `getSite`, `getEnvVars` (nombres) | ACTIVE, legacy |
| Vercel | `vercel api` read-only | ACTIVE, placeholder, Hobby |
| Supabase prod | SalvaOps bootstrap | CONNECTED (2026-09-27); detalle UNKNOWN |
| Brevo | Infra report + orquestador (2026-09-28) | VERIFIED histórico; actual UNVERIFIED |
| Cloudinary | Infra report (2026-09-27) | VERIFIED histórico |
| PostHog | Infra report | VERIFIED histórico (evento de smoke) |
| Sentry | Infra report | VERIFIED histórico (evento de smoke) |
| Google OAuth | Infra report | VERIFIED_CONFIGURATION histórico |

## 14. Estado de despliegue público actual

| URL | Origen | Contenido | Health |
| --- | --- | --- | --- |
| `https://runiismty.com` | Netlify, `main@bdd1198` | Placeholder | 200 `production` |
| `https://www.runiismty.com` | Netlify | 301 → apex | — |
| `https://staging--runiis-web.netlify.app` | Netlify, `staging@89b79d4` | Placeholder | 200 `staging` |
| `https://runiis-web.netlify.app` | Netlify | Placeholder | — |
| `https://runiis-web.vercel.app` | Vercel, `main@bdd1198` | Placeholder | 200 `staging` (falta `APP_ENV`) |
| `https://staging.runiismty.com` | Vercel (wildcard) | 404 | — |

`/eventos`, `/robots.txt`, `/sitemap.xml` → 404 en producción (el placeholder no los contiene).

## 15. Qué es seguro preservar

- Todo el código integrado en `staging` (`a2a9638`…`a9ef303`) con sus tests verdes.
- Esquema físico y cadena de migraciones 001–029, 040–042, 130–156, 300–321, 600–603, 700.
- ADR-001 y Amendment 1 como contrato técnico (con la actualización de hosting pendiente).
- Design system, shells, área de cuenta, discovery público, SEO.
- Diseño SQL T41 como base de reanudación.
- Provisionamiento de proveedores (Supabase prod, Brevo dominio, Cloudinary, PostHog, Sentry, Google OAuth, dominio y certificado Vercel).
- Netlify producción mientras no exista cutover validado.

## 16. Qué no debe reconstruirse

- Modelo de datos, RLS/RBAC, helpers y grants (82 tablas, 172 funciones `public`, 424 `private` en la DB local).
- Kernel de capacidad, lock order, holds/claims, idempotencia, outbox.
- Credenciales QR (AES-256-GCM, HKDF, AAD, hash check).
- Dispatcher de comunicaciones con prioridades y reserva de cuota.
- Race Day backend.
- Discovery/cache/SEO y foundations UI.
- Infra de pruebas (pgTAP, integración con dev server, Playwright con 3 viewports, lock de DB local).

## 17. Implicaciones para el Execution Roadmap (no es roadmap)

- Precondición: resguardo remoto del código (OWN-03) y reconciliación documental (AGENTS.md, índice SalvaOps, ADR de decisiones fuera del Master).
- Límite natural de outcome 1: "reanudar y cerrar T41" (dependencia de rankings).
- Límite natural de outcome 2: "un participante se inscribe de punta a punta" (F3 sobre APIs existentes + aceptación legal).
- Límite natural de outcome 3: "staff opera un evento" (admin UI + scanner sobre APIs existentes).
- Límite natural de outcome 4: "comunidad" (rankings, logros, perfil, avatar, sanciones, Task Center).
- Límite natural de outcome 5: "hosting Vercel" (puede prepararse en paralelo hasta Preview; cutover condicionado a OWN-01).
- Transversales: CI, observabilidad, AppSec/QA finales, backup/RPO/RTO, migración de DB productiva.
