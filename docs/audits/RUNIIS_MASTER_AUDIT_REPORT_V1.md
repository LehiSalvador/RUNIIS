# RUNIIS — Master Audit Report V1

| Campo | Valor |
| --- | --- |
| Fecha | 2026-10-01 America/Monterrey (2026-10-02 UTC) |
| Ejecutor | Claude principal, sesión única; sin agentes, sin subagentes, sin workflow multiagente |
| Modo | Read-only. Única escritura: `docs/audits/` (3 artefactos) |
| Baseline | `staging` @ `a9ef303d36e1ec91eaf0fbffc579d84b2bda5b6c`, working tree DIRTY (ver baseline doc) |
| Estado final | `AUDIT_COMPLETE_WITH_OPEN_ITEMS` |
| Documentos hermanos | `RUNIIS_CURRENT_IMPLEMENTATION_BASELINE_V1.md`, `RUNIIS_NETLIFY_TO_VERCEL_MIGRATION_READINESS_V1.md` |

Convenciones: FACT = observado en esta auditoría con evidencia citada; INFERENCE = deducción razonada; UNVERIFIED = no comprobable con el acceso disponible; DECISION = decisión registrada del owner o de documento autoritativo.

## 1. Audit baseline (resumen)

- FACT: rama `staging`, HEAD `a9ef303` (F2 account), 37 commits por delante de `origin/staging` (16 de `main` no fusionados en `origin/staging` + 21 commits V1). `main` = `origin/main` = `bdd1198`.
- FACT: working tree con 1 archivo modificado (`next-env.d.ts`, artefacto de `next dev`) y 6 rutas sin seguimiento: trabajo T41 (`lib/server/domain/closure/`, 4 migraciones `20260928180000..180300`, `supabase/tests/database/710_closure_attendance_lifecycle.test.sql`).
- FACT: ninguna superficie remota (Netlify producción, Netlify staging, Vercel) ejecuta código V1; las tres sirven el placeholder "RUNIIS WEB infrastructure ready".
- Detalle completo: `RUNIIS_CURRENT_IMPLEMENTATION_BASELINE_V1.md` §2–§4.

## 2. Master revision

| Atributo | Valor |
| --- | --- |
| Copia canónica | `docs/RUNIIS_WEB_SYSTEM_MASTER_SPEC_V2.md` |
| sha256 | `dbde42311c391bcffc5569df478ac8b687f4fde3e2d009f643d418878ef742bc` |
| Tamaño / líneas | 141 199 bytes / 5 030 líneas / 231 secciones numeradas |
| Historia Git | Único commit `17fc6c3` (2026-09-25 18:21 -0600); sin cambios posteriores |
| Copia externa | `C:\Users\lehi1\Downloads\RUNIIS_WEB_SYSTEM_MASTER_SPEC_V2.md`, sha256 `b3a93a22…6c2a`, 141 016 bytes, mtime 2026-09-25 17:10 |

FACT: el diff entre ambas copias es exclusivamente la reconciliación de media R2 → Cloudinary (§10 línea 221, §117 título y flujo de upload, folders Cloudinary, §180 "Cloudinary down", §192 Cloudinary, §193 variables Cloudinary, §196 referencias Cloudinary) más un espacio final en el ejemplo JSON de §164. La copia del repositorio es posterior (70 min) y es la reconciliada.

DECISION: la copia canónica es la del repositorio. Coincide con `.local-state/RUNIIS_ORCHESTRATION_STATE.json` (`authority.master`) y con ADR-001 ("Media provider is Cloudinary (reconciles Master R2 references)"). La copia de Downloads queda como histórica pre-reconciliación.

FACT residual: §197 todavía lista la métrica `R2_errors` (resto no reconciliado) — AUD-035.

FACT: `00_Documentacion/RUNIIIS_WEB_DOCUMENTO_MAESTRO.md` es un placeholder SalvaOps ("Pendiente de definir"), no la especificación. SalvaOps lo indexa como `MASTER` con autoridad 90 — AUD-014.

## 3. Coverage summary

Revisadas las 231 secciones completas. Agrupación por materia en §4.

| Clasificación | Grupos de secciones | Comentario |
| --- | --- | --- |
| COVERED | 38 | Dominio funcional, modelo físico, seguridad, API, UI foundations, tests, gates y DoD están especificados con detalle suficiente para implementar |
| GAP | 5 | Mecanismo de scheduler; política de cancelación; aceptación legal en onboarding; CAPTCHA anónimo; backup/RPO/RTO (pendiente externo) |
| AMBIGUOUS | 5 | §19 visibilidad de menores, §77 política operativa de cancelación, §121 "según capacidad", §145 permiso de export PII, §36 umbral LOW |
| CONTRADICTION | 2 | §11 principio de costo vs restricción comercial Vercel Hobby; §3 SUP-010 vs decisión owner Vercel |
| STALE | 7 | §10, §192, §193, §195, §200 (paso staging), §197 `R2_errors`, §221 (estado de pendientes) |
| DUPLICATED | 3 | Parámetros OTP (§17/§155/§179), invalidadores de cache vs domain events (§60/§151), catálogo vs prioridades (§133/§141) — consistentes, no conflictivos |
| SUPERSEDED | 2 | §222 Claude Orchestration Envelope y §223 Orden de implementación como mecanismo de ejecución (nuevo modelo: SalvaOps Web Development 1.3.1, roadmap por outcomes) |

Conclusión de cobertura: el Master es suficiente como fuente funcional. Ninguna GAP impide construir el Execution Roadmap; las correcciones necesarias son de infraestructura/hosting y de registro de decisiones tomadas fuera del Master.

## 4. Coverage matrix

| Secciones | Materia | Estado | Nota |
| --- | --- | --- | --- |
| §0–§1 | Propósito, jerarquía de autoridad | COVERED | Jerarquía compatible con la del owner para esta auditoría |
| §2 | Fuentes consolidadas | COVERED | S06 conserva "RESEND" en el título; email vigente es Brevo (INFO) |
| §3 | Decisiones sustituidas | CONTRADICTION | SUP-010 ("Vercel Hobby como hosting productivo asumido. No vigente") choca con la decisión owner 2026-10-01 TARGET=VERCEL; debe reescribirse, no borrarse (el motivo histórico — restricción comercial Hobby — sigue vigente, ver AUD-001) |
| §4–§7 | Producto, North Star, alcance V1, parking lot V2 | COVERED | |
| §8–§9 | Glosario, actores | COVERED | |
| §10 | Arquitectura | STALE | "Netlify como hosting inicial seleccionado" |
| §11 | Principios de costo | CONTRADICTION | "El núcleo V1 no debe requerir una suscripción mensual obligatoria"; Vercel Hobby prohíbe uso comercial (fair-use, consultado 2026-10-01) |
| §12–§14 | Schemas, convenciones, extensiones | COVERED | §14 no lista `pg_cron`/`pg_net`, que ADR-001 dec. 10 sí usa (GAP menor de registro) |
| §15–§17 | Auth, onboarding, Google/OTP | COVERED | Momento de aceptación de TERMS/PRIVACY no especificado (GAP; ver F2-F1) |
| §18–§25 | Community profile, menores, guardianes, Friends, People search, Guests | COVERED | §19 "perfil básico público según la decisión vigente" AMBIGUOUS; resuelto en ADR-001 A10 (`is_searchable=false`) |
| §26–§33 | Event type, Event, Edition, schedule revisions, readiness, transitions, cancel/reprogram | COVERED | |
| §34–§42 | Modality, capacity, availability, concurrency, price, category, forms | COVERED | §36 umbral LOW = `availability_low_threshold_percent` nullable (IMPLEMENTATION_FLEXIBLE) |
| §43–§52 | Locations, agenda, routes, revisions, POI, editor, GPX, validation, content, media | COVERED | |
| §53–§60 | Discovery, search, URL state, states, card, event page, SEO, cache | COVERED | §53 no enumera rutas de cuenta/inscripción/admin/scanner (IMPLEMENTATION_FLEXIBLE; implementación eligió `/cuenta`, `/entrar`, `/inscripcion/{slug}`, `/admin`, `/scanner`) |
| §61–§76 | Registration request, participants, hold, 24h, preconditions, claims, transaction, WhatsApp, pending UX, admin queue, confirm, FREE, Registration | COVERED | |
| §77–§79 | Cancel registration, change modality, revision | AMBIGUOUS | §77 "según política operativa" sin política definida |
| §80–§85 | Pass, credential, QR security, replacement, access, scan | COVERED | ADR-001 A1–A3 precisa emisión SYSTEM-only, AAD y emails |
| §86–§89 | Kits | COVERED | |
| §90–§101 | Check-in, attendance, eligibility, universe, finalization, closure, readiness, protocol, reopen, DistanceCredit, sport_date, competitive eligibility | COVERED | |
| §102–§112 | Epoch, periods, projection, empates, readiness, snapshots, historical cut, achievements | COVERED | |
| §113–§118 | Home community, perfil público, avatar, Cloudinary, moderación | COVERED | |
| §119–§122 | Sanciones, identity lock, ban, blocked identity | COVERED | §121 "Auth ban/session invalidation según capacidad" AMBIGUOUS |
| §123–§124 | Legal documents/acceptance | COVERED | Textos finales = pendiente externo |
| §125–§141 | Comunicaciones (recipient, contact point, consent, reminders, templates, automations, catálogo, campaigns, messages, attempts, provider events, suppression, usage, prioridad) | COVERED | CAPTCHA de recordatorio anónimo no especificado; decisión SEC-082 (ALTCHA self-hosted) vive solo en `.local-state` y código (GAP de registro) |
| §142–§143 | Admin Task, Task rules | COVERED | |
| §144–§145 | Staff, roles, RBAC | COVERED | §145 "Export PII requiere permiso explícito o scope definido" AMBIGUOUS |
| §146–§151 | Audit, outbox, recovery, idempotency, worker run, domain events | COVERED | |
| §152–§153 | Workers, ranking period manager | COVERED (frecuencias) / GAP (mecanismo) | Frecuencias sub-horarias (1–15 min) sin mecanismo definido en el Master; ADR-001 dec. 10 lo fija en Netlify Scheduled Functions (STALE con Vercel) |
| §154–§155 | Integrity case, platform settings | COVERED | |
| §156–§163 | RLS, helpers, matriz, grants, column security, constraints, ON DELETE, índices | COVERED | |
| §164–§177 | API | COVERED | Deriva de rutas vs implementación (AUD-027) |
| §178–§180 | Error taxonomy, rate limits, provider failures | COVERED | |
| §181–§191 | Foundations visuales, tipografía, iconos, runline, grid, spacing, radii, motion, responsive, a11y, performance | COVERED | |
| §192 | Infrastructure decision status | STALE | Netlify como hosting V1 |
| §193–§194 | Credenciales | STALE | Lista `NETLIFY_SITE_ID`/`NETLIFY_AUTH_TOKEN`; omite `APP_ENV`, `EMAIL_DELIVERY_MODE`, `EMAIL_ALLOWLIST` (exigidas por el código); `DEFAULT_WHATSAPP_PHONE_E164` no es leída por el código (DB `platform_settings`) |
| §195 | Environments | STALE | No refleja el modelo owner 2026-09-27 (ADR-001: Supabase remoto staging no autoritativo; host staging solo build/UI/smoke) ni el mapeo a Vercel Preview |
| §196 | Backup and recovery | GAP | RPO/RTO y restore test pendientes (PEND-RECOVERY-001) |
| §197 | Observability | COVERED / STALE | Métrica `R2_errors` |
| §198 | Analytics | COVERED | |
| §199–§201 | Migrations, rules, seeds | COVERED / STALE | §200 exige paso "staging" de DB; el modelo owner declara el Supabase remoto staging no autoritativo |
| §202–§209 | Test traceability, unit, DB, RLS, integration, E2E, security, load | COVERED | |
| §210–§218 | Gates 0–8 | COVERED | Estado de Gate 0 no registrado formalmente (OPEN) |
| §219–§220 | Definition of Done | COVERED | |
| §221 | Pendientes externos | COVERED / STALE | PEND-INFRA-002 (dominio) ya existe; PEND-INFRA-001 parcial |
| §222 | Claude orchestration envelope | SUPERSEDED | Modelo vigente: SalvaOps Web Development 1.3.1, fresh orchestrator por fase, roadmap por outcomes (decisión owner) |
| §223 | Orden de implementación | SUPERSEDED (como mecanismo) | Sigue siendo referencia de dependencias, no plan de ejecución |
| §224–§231 | Sources of truth, non-authoritative, audit register, pain points, superficies admin, routing QR, anti-patterns, criterio final | COVERED | |

## 5. GAP / AMBIGUOUS / CONTRADICTION / STALE / DUPLICATED / SUPERSEDED

### 5.1 GAP

| ID | Sección | Ausencia | Impacto | Clasificación de decisión |
| --- | --- | --- | --- | --- |
| M-GAP-01 | §152, §10 | Mecanismo de ejecución de workers sub-horarios | Con Vercel Hobby (cron diario) el diseño de ADR-001 dec. 10 deja de ser ejecutable | IMPLEMENTATION_FLEXIBLE (ver migration readiness §17) |
| M-GAP-02 | §77 | Política operativa de cancelación de Registration confirmada antes del evento | T41 `cancel_registration` implementa una regla sin política escrita | OWNER_DECISION |
| M-GAP-03 | §16, §123–§124 | Momento y alcance de aceptación de TERMS_OF_SERVICE/PRIVACY_NOTICE (onboarding vs inscripción) | F2-F1: onboarding no registra aceptación | OWNER_DECISION (con asesor legal) |
| M-GAP-04 | §130, §176 | Protección anti-abuso del recordatorio anónimo | Resuelto por orquestador (SEC-082, ALTCHA) sin ADR versionado | IMPLEMENTATION_FLEXIBLE; registrar en ADR |
| M-GAP-05 | §196 | RPO/RTO, estrategia de export y restore test | Bloquea Gate 8 | OWNER_DECISION (PEND-RECOVERY-001) |

### 5.2 AMBIGUOUS

| ID | Sección | Texto | Resolución actual |
| --- | --- | --- | --- |
| M-AMB-01 | §19 | "menor puede tener perfil básico público según la decisión vigente" | ADR-001 A10: visible pero no buscable; guardian nunca público |
| M-AMB-02 | §77 | "puede permitirse según política operativa" | Sin resolver (M-GAP-02) |
| M-AMB-03 | §121 | "Auth ban/session invalidation según capacidad" | Sin resolver; ADR-001 A7 cubre altas bloqueadas, no invalidación de sesiones activas |
| M-AMB-04 | §145 | "Export PII requiere permiso explícito o scope definido" | Implementación de export CSV existe (T34); permiso explícito no definido en Master (IMPLEMENTATION_FLEXIBLE) |
| M-AMB-05 | §36 | Umbral LOW | `platform_settings.availability_low_threshold_percent` nullable (IMPLEMENTATION_FLEXIBLE) |

### 5.3 CONTRADICTION

| ID | Secciones | Contradicción | Evidencia |
| --- | --- | --- | --- |
| M-CON-01 | §11 vs decisión owner Vercel | El núcleo V1 no debe exigir suscripción; Vercel Hobby restringe a uso personal no comercial ("Any method of requesting or processing payment from visitors of the site") | `https://vercel.com/docs/limits/fair-use-guidelines` (last_updated 2026-09-14, consultado 2026-10-01); team `lehisalvadors-projects` plan `hobby` (API Vercel, read-only). INFERENCE: RUNIIS solicita pago externo de inscripciones vía WhatsApp → uso comercial |
| M-CON-02 | §3 SUP-010, §10, §192 vs decisión owner | Master declara Netlify hosting V1 y SUP-010 "Vercel Hobby no vigente"; owner cerró TARGET=VERCEL | Decisión owner 2026-10-01 (CLOSED) |
| M-CON-03 | Master §176 vs implementación | Webhook `/api/webhooks/email-provider` vs `/api/webhooks/brevo` (rompe la neutralidad de proveedor que pide el Master) | `app/api/webhooks/brevo/route.ts` |

### 5.4 STALE

| ID | Sección | Contenido stale | Sustituto |
| --- | --- | --- | --- |
| M-STA-01 | §10 | "Netlify como hosting inicial seleccionado" | Vercel (target), Netlify CURRENT_LEGACY_HOSTING_PENDING_MIGRATION |
| M-STA-02 | §192 | Netlify en estado de decisión de infraestructura | Igual |
| M-STA-03 | §193 | Variables Netlify; falta `APP_ENV`, `EMAIL_DELIVERY_MODE`, `EMAIL_ALLOWLIST`; `CRON_SECRET` si se adopta Vercel Cron | Inventario real en migration readiness §8 |
| M-STA-04 | §195 | Entornos local/preview/staging/production sin modelo owner 2026-09-27 | ADR-001 "Verified context" + topología Vercel objetivo |
| M-STA-05 | §197 | Métrica `R2_errors` | `media_provider_errors` / Cloudinary |
| M-STA-06 | §200 | Paso "staging" de DB | Local Docker como entorno de verificación; producción vía SalvaOps (ADR-001) |
| M-STA-07 | §221 | PEND-INFRA-002 dominio/DNS como pendiente | Dominio `runiismty.com` registrado en Vercel (auto-renew desactivado, ver AUD-011) |
| M-STA-08 | ADR-001 dec. 10 y "Verified context" | Netlify Scheduled Functions, `netlify/functions/`, `staging--runiis-web.netlify.app` | Requiere ADR de hosting/scheduler en la fase de migración |

### 5.5 DUPLICATED

- M-DUP-01 §17/§155/§179: parámetros OTP (6 dígitos, 600 s, 60 s). Consistentes.
- M-DUP-02 §60/§151: invalidadores de cache y domain events solapados. Consistentes; `lib/server/cache/invalidation.ts` es el único mapeo.
- M-DUP-03 §133/§141: prioridades por mensaje repetidas. Consistentes.

### 5.6 SUPERSEDED

- M-SUP-01 §222: modelo de orquestación Claude multiagente libre. Sustituido por SalvaOps Web Development 1.3.1 con fresh orchestrator por fase (DECISION owner).
- M-SUP-02 §223: orden lineal de implementación como plan de ejecución. Sustituido por roadmap por outcomes; conserva valor como grafo de dependencias.

## 6. Decision classification

### 6.1 CLOSED

| Decisión | Fuente |
| --- | --- |
| RUNIIS es el producto del Master V2; no se reinicia ni reconstruye | Owner (esta tarea) |
| TARGET_PRODUCTION_HOSTING = VERCEL; Netlify = CURRENT_LEGACY_HOSTING_PENDING_MIGRATION | Owner 2026-10-01 |
| Ejecución posterior: SalvaOps Web Development 1.3.1, 13 especialistas Sonnet 5.5, fresh orchestrator por fase, roadmap por outcomes | Owner |
| Sin billing, upgrades, trials con tarjeta ni add-ons pagados sin autorización | Owner |
| Pagos integrados fuera de V1; pago externo coordinado por WhatsApp; hold absoluto 24 h | Master §2–§3 |
| Friends V1, GuestParticipant V1 sin créditos, menores 15–17 con guardian y verificación presencial | Master §19–§25 |
| Google + Email OTP; Apple fuera | Master §17 |
| Supabase (DB/Auth/RLS/PostGIS), Cloudinary (media), Brevo (email), MapLibre + OpenFreeMap | Master §10/§192 (reconciliado), ADR-001 |
| Modelo de entornos: Supabase producción único autoritativo vía SalvaOps; local Docker para dev/tests; host staging solo build/UI/smoke; Supabase remoto staging no autoritativo | Owner 2026-09-27, ADR-001 commit `a15735f` |
| Arquitectura de commands/queries, lock order, errores, idempotencia, crypto QR, CSP, sesiones HttpOnly sin cliente browser | ADR-001 + Amendment 1 (A1–A10) |

### 6.2 OPEN

| ID | Decisión | Por qué sigue abierta |
| --- | --- | --- |
| OPEN-01 | Mecanismo de scheduling en Vercel para workers de 1–15 min | Depende del plan Vercel (OWN-01); alternativa gratuita disponible (Supabase `pg_cron` + `pg_net`) |
| OPEN-02 | Backend Supabase para Vercel Preview / rama `staging` | Modelo owner prohíbe producción en staging; Supabase remoto staging está marcado no autoritativo |
| OPEN-03 | SEC-001 PostgREST pre-request gateway | Diferido en ADR-001 A4; requiere secreto por entorno |
| OPEN-04 | Estrategia de capacidad de email (Brevo free 300/día compartido) | PEND-EMAIL-001 |
| OPEN-05 | Ventana y criterio de retiro de Netlify | Posterior a cutover validado |
| OPEN-06 | Estado formal de Gate 0 (Definition Freeze) tras correcciones del Master | Correcciones §9 de este documento |

### 6.3 IMPLEMENTATION_FLEXIBLE

- Rutas de UI no enumeradas en §53 (`/cuenta/*`, `/entrar`, `/inscripcion/{slug}`, `/admin/*`, `/scanner`).
- CAPTCHA anónimo (ALTCHA self-hosted; registrar en ADR).
- Umbral LOW de disponibilidad.
- Detección de IP cliente por plataforma (encapsulada en `lib/server/http/client-ip.ts`).
- Scheduler concreto (pg_cron+pg_net, Vercel Cron, GitHub Actions) siempre que preserve contratos de worker.
- Nombres de rutas API mientras el contrato funcional se mantenga (alinear Master o código).

### 6.4 OWNER_DECISION

| ID | Decisión requerida | Bloquea |
| --- | --- | --- |
| OWN-01 | Plan Vercel compatible con uso comercial de RUNIIS (Hobby prohíbe uso comercial; Pro es de pago) o confirmación formal de Vercel de que RUNIIS no es comercial. Tensión con Master §11 y con "sin billing" | Cutover productivo a Vercel; scheduler por minuto nativo |
| OWN-02 | Renovación de `runiismty.com` (registrado en Vercel, expira 2027-09-24, `renew=false`; renovar implica pago) | Continuidad del dominio |
| OWN-03 | Visibilidad del repositorio GitHub (`LehiSalvador/RUNIIS` es público) antes de publicar los 21 commits V1 y el trabajo T41 | Respaldo remoto y CI |
| OWN-04 | Política de cancelación de Registration confirmada (M-GAP-02) | Cierre de T41 cancel/change-modality |
| OWN-05 | Aceptación de TERMS/PRIVACY en onboarding (M-GAP-03) | Gate 3 / producción legal |
| OWN-06 | RPO/RTO (PEND-RECOVERY-001) | Gate 8 |
| OWN-07 | Pendientes externos ya registrados: PEND-LEGAL-001/002, PEND-OPS-001 (WhatsApp real), PEND-BRAND-001 | Producción |

## 7. Known errors (diagnóstico de esta auditoría)

Ejecutados una sola vez sobre el baseline; logs en scratchpad de sesión (efímeros). Ningún archivo rastreado cambió (verificado por hash y `git status`).

| Verificación | Resultado | Nota |
| --- | --- | --- |
| `pnpm run typecheck` | PASS | Incluye archivos T41 sin seguimiento |
| `pnpm run lint` | PASS | |
| `pnpm test` (unit) | PASS 463/463, 46 archivos | |
| `pnpm run build` (Next 16.3.6 Turbopack) | PASS | Errores `DEPENDENCY_UNAVAILABLE` en prerender de `/legal/*` (DB local apagada en el momento del build); el build no falla. `next-env.d.ts` restaurado a su contenido de baseline |
| `pnpm db:test` (pgTAP, Supabase local) | FAIL | 32/33 archivos OK, 1017 aserciones ejecutadas; `710_closure_attendance_lifecycle.test.sql` aborta en línea 135 (`operator does not exist: text ->> unknown`), 10/24 planificadas |
| `pnpm test:integration` | PASS 60/60, 10 archivos | Contra dev server local `:3100` y Supabase local |
| Playwright E2E (3 proyectos) | PASS 229, SKIP 17, FAIL 0 | 246 tests, 11 specs, 4.5 min |
| Rutas locales | `/`, `/eventos`, `/runiis`, `/contacto`, `/legal/terminos`, `/entrar`, `/cuenta` → 200; `/ranking`, `/admin`, `/scanner` → 404 | `/inscripcion/{slug}` enlazada por la CTA y no existe |
| gitleaks (historia, 46 commits) | 1 coincidencia | `.env.example:6` placeholder vacío conocido |
| gitleaks (árbol) | Solo archivos ignorados | `.env.*` locales, caches `.next`, un log de evidencia; ningún archivo rastreado salvo el placeholder |

## 8. Finding register

Severidad: CRITICAL 0, HIGH 8, MEDIUM 17, LOW 12, INFO 6 (total 43). Ningún finding justificó detener la auditoría. Formato por finding: severidad · área · tipo; descripción; evidencia; requisito; superficie; impacto actual; especialidad futura; relevancia roadmap; disposición.

### HIGH

**AUD-001** · HIGH · hosting/billing · CONTRADICTION/OWNER_DECISION
- Descripción: el target Vercel corre hoy en team Hobby; Vercel restringe Hobby a uso personal no comercial. RUNIIS solicita pago (externo, WhatsApp) por inscripciones.
- Evidencia: fair-use guidelines (consultado 2026-10-01); `GET /v2/teams/team_HyzbsOaKDet7pos4oNDbVI8g` → `plan: hobby`.
- Requisito: Master §11, §3 SUP-010; owner "sin billing".
- Superficie: Vercel team `lehisalvadors-projects`, proyecto `runiis-web`.
- Impacto actual: ninguno (Vercel no sirve producción). Impacto en cutover: incumplimiento de términos o necesidad de plan de pago.
- Especialidad: web-architect + owner.
- Roadmap: precondición de la fase de cutover.
- Disposición: OWN-01 antes del cutover; no ejecutar cutover productivo en Hobby sin decisión explícita.

**AUD-002** · HIGH · workers/infra · BLOCKER de migración
- Descripción: 4 workers dependientes de proveedor se disparan con Netlify Scheduled Functions (cada 1, 5, 15 min y diario). Vercel Hobby solo permite cron diario con precisión ±59 min. La ruta worker solo exporta `POST`; Vercel Cron invoca `GET` con `CRON_SECRET`.
- Evidencia: `netlify/functions/*.ts`; `app/api/internal/workers/[worker]/route.ts`; `https://vercel.com/docs/cron-jobs/usage-and-pricing` (2026-07-15).
- Requisito: Master §147–§148, §152; ADR-001 dec. 10.
- Superficie: outbox/email dispatch, emisión de credenciales QR, reconciliación de comunicaciones y uso de proveedor.
- Impacto actual: ninguno en producción (ver AUD-037). Post-cutover sin sustituto: emails P0/P1 y QR no se emiten.
- Especialidad: integrations + database.
- Roadmap: componente obligatorio de la fase de migración.
- Disposición: decidir OPEN-01; alternativa gratuita validada documentalmente: Supabase `pg_cron` + `pg_net` hacia las rutas POST existentes.

**AUD-003** · HIGH · repositorio/continuidad · riesgo de pérdida
- Descripción: toda la implementación V1 (21 commits, ~21.5 k líneas TS/TSX y ~20.3 k líneas SQL) y el WIP T41 existen solo en el disco local. `origin/staging` está en `89b79d4`; SalvaOps ledger vacío (`ledger.present=false`).
- Evidencia: `git rev-list --count origin/staging..staging` = 37; bootstrap SalvaOps.
- Requisito: Master §196 (repo GitHub como backup).
- Superficie: `C:\PROYECTOS_CLAUDE\RUNIIIS WEB`.
- Impacto actual: copia única; un fallo de disco pierde el trabajo de la campaña anterior.
- Especialidad: owner + web-architect.
- Roadmap: primera acción de la siguiente fase (antes de cualquier desarrollo).
- Disposición: decidir OWN-03 y luego publicar/capturar; no ejecutado en esta auditoría.

**AUD-004** · HIGH · seguridad/rate-limit · BLOCKER de migración
- Descripción: `getClientIp` confía exclusivamente en `x-nf-client-connection-ip` (Netlify). En Vercel el header no existe; fuera de `local` todas las peticiones anónimas caen en un único bucket `unknown` de límite estricto.
- Evidencia: `lib/server/http/client-ip.ts:11–31`; consumidores: `/api/v1/auth/otp`, `/auth/verify`, `/reminders`, `/reminders/confirm`, `/communications/unsubscribe`, `/api/webhooks/brevo`, `/api/csp-report`. Vercel documenta `x-real-ip`/`x-vercel-forwarded-for` como IP cliente no falsificable.
- Requisito: Master §179; ADR-001 A6; SEC-141.
- Superficie: login OTP y endpoints anónimos.
- Impacto actual: ninguno (Netlify). En Vercel: el login OTP de todos los usuarios comparte una cuota global (auto-DoS).
- Especialidad: auth + backend.
- Roadmap: código previo al primer Preview funcional en Vercel.
- Disposición: CODE_CHANGE_REQUIRED con selección de header por plataforma y tests.

**AUD-005** · HIGH · entorno · BLOCKER de migración
- Descripción: el proyecto Vercel tiene 24 variables (exactamente el set de `.env.example`), todas `sensitive`, con un único scope compartido `production,preview`, creadas el 2026-09-27 06:17 UTC. Faltan `APP_ENV` (obligatoria en `lib/server/env.ts`; `proxy.ts` la parsea en cada request → toda request respondería 500 con código V1), `EMAIL_DELIVERY_MODE` y `EMAIL_ALLOWLIST`. Procedencia de valores UNKNOWN.
- Evidencia: `GET /v9/projects/runiis-web` y `/v10/projects/runiis-web/env` (solo nombres/metadata); `curl https://runiis-web.vercel.app/api/health` → `"environment":"staging"`.
- Requisito: Master §195 (production secrets nunca en preview); ADR-001 A9 (EMAIL mode fail-safe).
- Superficie: Vercel Production y Preview.
- Impacto actual: ninguno sobre usuarios; el despliegue productivo Vercel corre el placeholder.
- Especialidad: integrations + web-architect.
- Roadmap: fase de migración, paso de env parity.
- Disposición: CONFIG_CHANGE_REQUIRED; separar valores por entorno y verificar procedencia sin exponer valores.

**AUD-006** · HIGH · email/proveedor · REQUIRES_VERIFICATION
- Descripción: Brevo activa automáticamente el bloqueo de IPs desconocidas para API (y SMTP según su ayuda) tras 30 días sin IPs nuevas, autorizando solo /24 aprendidas. Netlify y Vercel usan IPs de salida dinámicas; Supabase SMTP (OTP) también egresa desde IPs de Supabase.
- Evidencia: `help.brevo.com/hc/en-us/articles/5740111683858` (consultado 2026-10-01). Estado actual de la cuenta: UNVERIFIED. INFERENCE: credenciales creadas ~2026-09-26 → activación posible desde ~2026-10-26 si no aparecen IPs nuevas.
- Requisito: Master §133 (AUTH_OTP P0), §141, §180.
- Superficie: Brevo API (app) y SMTP (Supabase Auth).
- Impacto actual: potencial bloqueo de OTP y emails transaccionales en cualquier host serverless.
- Especialidad: integrations.
- Roadmap: verificación previa a cualquier apertura real; independiente del hosting.
- Disposición: verificar `Settings > Security > Authorized IPs` en Brevo (provider config, fuera de esta auditoría).

**AUD-007** · HIGH · producto/UI · NOT_IMPLEMENTED
- Descripción: faltan las superficies que materializan el North Star y la operación: UI de inscripción (F3; la CTA "Inscribirme" enlaza a `/inscripcion/{slug}` → 404), panel admin (F4; `/admin` solo layout placeholder → 404) y scanner Race Day (F5; `/scanner` → 404).
- Evidencia: `components/public/event/availability.tsx:164`; `app/admin/layout.tsx`; `app/scanner/layout.tsx`; sondeo local.
- Requisito: Master §53, §58, §69, §70, §228; Gates 2, 3, 5.
- Superficie: frontend.
- Impacto actual: un usuario no puede inscribirse por UI; staff solo opera vía API.
- Especialidad: ux + ui + frontend (+ qa).
- Roadmap: bloque principal de trabajo restante.
- Disposición: planificar por outcome; reutilizar APIs existentes.

**AUD-008** · HIGH · dominio post-evento y comunidad · PARTIAL/NOT_IMPLEMENTED
- Descripción: T41 PARTIAL (sin rutas API, sin tests de créditos/cancel, pgTAP rojo); T42 (rankings, snapshots, achievements, perfil público, `/ranking`, `/personas/{id}`), T36 (avatar, upload Cloudinary firmado, sanciones/ban/identity lock commands), T43 (Task Center, integrity scan, ranking period manager) sin implementación más allá del esquema físico.
- Evidencia: `RUNIIS_CURRENT_IMPLEMENTATION_BASELINE_V1.md` §6–§7; ausencia de funciones `*ranking*`, `*achievement*`, `*sanction*`, `*ban*` en `supabase/migrations`.
- Requisito: Master §90–§122, §142–§154; Gates 6, 7.
- Superficie: DB commands, API, UI comunidad/admin.
- Impacto actual: no hay cierre de eventos, kilómetros, rankings ni moderación.
- Especialidad: backend + database + frontend.
- Roadmap: bloques de outcome "cerrar evento" y "comunidad".
- Disposición: continuar desde el esquema existente; no rediseñar.

### MEDIUM

**AUD-009** · MEDIUM · DB tests · BROKEN — pgTAP rojo en working tree: `710_closure_attendance_lifecycle.test.sql:135` usa `(... ) ->> 'detail' ->> 'reason'` sobre `text`; aborta tras 10/24. HEAD sin WIP: 32/32 verdes (1007 aserciones). Requisito §204, §216. Superficie: test T41 (sin seguimiento). Especialidad: database. Disposición: corregir dentro de la reanudación de T41; no tocado.

**AUD-010** · MEDIUM · dominio · CONFIG_CHANGE_REQUIRED — el proyecto Vercel tiene `runiismty.com` con redirect 308 → `www.runiismty.com` (asignado 2026-09-27T07:21Z); Netlify hace lo inverso (`www` → apex) y el canonical/`APP_BASE_URL` es apex. Evidencia: `GET /v9/projects/runiis-web/domains`; `curl -I https://www.runiismty.com/` → 301 a apex (Netlify). Impacto en cutover: canonical apuntando a URL que redirige, cookies/OAuth en host inesperado. Especialidad: seo + integrations. Disposición: invertir antes del cutover.

**AUD-011** · MEDIUM · dominio · OWNER_DECISION — `runiismty.com` registrado vía Vercel (2026-09-24), expira 2027-09-24, `renew: false`. Evidencia: `GET /v5/domains/runiismty.com`. Impacto: caída total del producto al expirar. Disposición: OWN-02.

**AUD-012** · MEDIUM · seguridad/repositorio · OWNER_DECISION — `LehiSalvador/RUNIIS` es público (`visibility: public`), ramas sin protección. Publicar V1 expone código, tests RLS y diseño de seguridad (sin secretos, según gitleaks). Evidencia: `api.github.com/repos/LehiSalvador/RUNIIS` sin autenticación → 200. Disposición: OWN-03.

**AUD-013** · MEDIUM · documentación · STALE/CONTRADICTION — Master §3 SUP-010, §10, §192, §193 y ADR-001 ("Verified context", dec. 10, Layout `netlify/functions/`) describen Netlify como hosting. Disposición: correcciones §9.

**AUD-014** · MEDIUM · workflow/SalvaOps · STALE — `AGENTS.md`/`CLAUDE.md` envían a `00_Documentacion/RUNIIIS_WEB_DOCUMENTO_MAESTRO.md` (placeholder) y `40_Codigo`; SalvaOps indexa 3 documentos (último escaneo 2026-09-26) con el placeholder como MASTER autoridad 90; el Master real y ADR-001 no están indexados. `AGENTS.md`, `CLAUDE.md` y `00_Documentacion/` están en `.git/info/exclude`. Impacto: agentes que usen `salvaops context` reciben autoridad incorrecta. Especialidad: web-architect + owner (SalvaOps). Disposición: reconciliar antes de lanzar especialistas.

**AUD-015** · MEDIUM · plataforma · CODE_CHANGE_REQUIRED — importación GPX acepta envelope JSON de hasta 7.5 MB (5 MB decodificados + base64); Vercel Functions limita request body a 4.5 MB (doc oficial `functions/limitations`, last_updated 2026-08-24). Evidencia: `app/api/v1/admin/routes/[routeId]/import-gpx/route.ts`, `lib/server/domain/routes/gpx-parser.ts:12`. Nota: el límite de Netlify (~6 MB síncrono) no fue re-verificado. Disposición: bajar límite o subir GPX por canal directo.

**AUD-016** · MEDIUM · CI · NOT_IMPLEMENTED — no existe `.github/`; Master §10 lista GitHub Actions. Gates solo se ejecutan manualmente. Especialidad: web-architect/qa. Disposición: fase de plataforma.

**AUD-017** · MEDIUM · observabilidad · NOT_IMPLEMENTED — sin SDK Sentry ni PostHog en `package.json`/código; métricas y alertas §197 inexistentes; Vercel Hobby retiene runtime logs 1 h. Evidencia: grep, doc plan Hobby. Disposición: incluir antes de producción.

**AUD-018** · MEDIUM · legal/onboarding · PARTIAL — onboarding no registra aceptación TERMS/PRIVACY; no existe lectura pública de versiones legales por id (F2-F1, F2-F3 abiertos; verificado por grep). Disposición: OWN-05 + backend auth.

**AUD-019** · MEDIUM · Supabase remoto · UNVERIFIED — estado de producción `mdzhsoeqagtwznybwtuy` desconocido: migraciones V1 no aplicadas (INFERENCE: cola del orquestador "prod migration+deploy" pendiente), config Auth remota (hook `before_user_created`, OTP, redirect allowlist, SMTP) no verificable. SalvaOps `supabase.*` UNAVAILABLE (Desktop cerrado); Supabase CLI `Unauthorized`. Disposición: verificación read-only vía SalvaOps al inicio de la siguiente fase.

**AUD-020** · MEDIUM · seguridad · UNVERIFIED — AppSec final (V2), QA E2E integral (V1), Integration Evidence (V3) y Human Simulation (V4) no ejecutados; remediaciones AppSec-R1 (SEC-FIX-1) sin re-verificación independiente; SEC-001 diferido; CSP no observada en host real. Disposición: gate de seguridad antes de producción.

**AUD-021** · MEDIUM · despliegue · hazard de doble despliegue — Vercel tiene Git integration activa (`createDeployments: enabled`, production branch `main`) en paralelo a Netlify. Cualquier push a `main`/`staging` crea deployments Vercel con env no validado. Preview protegido por Vercel Authentication (`all_except_custom_domains`). Disposición: definir política de auto-deploy durante la transición.

**AUD-022** · MEDIUM · capacidad email · OPEN — Brevo free 300 envíos/día compartidos por OTP, transaccional y campañas (dato orquestador 2026-09-28, `GET /v3/account`). Picos de inscripción pueden agotarlo. Disposición: PEND-EMAIL-001 antes de apertura real.

**AUD-023** · MEDIUM · Auth/OAuth · CONFIG_CHANGE_REQUIRED (UNVERIFIED remoto) — allowlist de redirect Supabase solo contempla local (config.toml) y, según infra report, URLs staging Netlify; no hay patrón para Vercel Preview/branch domain. Disposición: actualizar en fase de migración (Supabase docs recomiendan `https://*-<team>.vercel.app/**`).

**AUD-024** · MEDIUM · recuperación · GAP — sin RPO/RTO, export adicional ni restore test (PEND-RECOVERY-001). Disposición: OWN-06.

**AUD-025** · MEDIUM · workflow · STALE — `.local-state/RUNIIS_ORCHESTRATION_STATE.json` declara G0 `IN_PROGRESS`, G1–G8 `PENDING`, `last_verified_postcondition` en `af34ae8`, T41 "CHECKPOINTING", findings ya resueltos como abiertos (p. ej. T11-F6: AAD y hash check existen en `lib/server/crypto/pass-credential.ts:107–139`). Decisiones (ALTCHA SEC-082, política de scheduler) viven solo en `.local-state` ignorado por Git. Además, las especificaciones derivadas que el código y ADR-001 A1–A10 citan — threat model T11 (56 KB, SEC-nnn), UX spec T12 (55 KB) y UI spec T13 (72 KB) — existen solo en `.salvaops-agent-evidence/` (ignorado por Git, sin respaldo remoto). Disposición: no usar `.local-state` como estado durable; migrar decisiones a ADR y promover las tres especificaciones a `docs/` versionado en una fase documental.

### LOW

**AUD-026** · LOW · migraciones — timestamps T41 `20260928180000–180300` anteriores al commit SEC-FIX-1 `20260928210000`. Local reset aplica en orden sin error; en una DB que ya tuviera `210000` el CLI las trataría como fuera de orden. Disposición: renumerar al integrar T41 si algún entorno ya aplicó `210000`.

**AUD-027** · LOW · contrato API — deriva Master vs código: `/api/webhooks/brevo` (§176 `/email-provider`), `/api/v1/reminders` + `/challenge` (§176 `/reminders/anonymous`), `/admin/editions/:id/capacity` (§169 `/global-capacity`). Disposición: alinear Master o código.

**AUD-028** · LOW · health — `/api/health` reporta `staging` para cualquier `APP_ENV` distinto de `production` (incluye `local` y ausencia de variable); hoy Vercel producción responde `staging`. Disposición: ajustar en migración.

**AUD-029** · LOW · secretos innecesarios — variables no leídas por el código en hosts: Netlify `DATABASE_URL` (branch staging), `GOOGLE_CLIENT_ID/SECRET`, `SUPABASE_PROJECT_REF`, `SECRETS_SCAN_OMIT_KEYS`; Vercel `GOOGLE_CLIENT_*`, `DEFAULT_WHATSAPP_PHONE_E164`, `BREVO_SMTP_*` (SMTP lo usa Supabase Auth, no la app). Disposición: no copiar a Vercel lo no requerido.

**AUD-030** · LOW · `.env.example` — omite `APP_ENV`, `EMAIL_DELIVERY_MODE`, `EMAIL_ALLOWLIST`, `NEXT_PUBLIC_MAP_STYLE_URL`, `MAILPIT_URL`; incluye `GOOGLE_*` no usados.

**AUD-031** · LOW · comunicaciones — plantillas marketing sin enlace visible de baja ni landing GET; tokens de baja en query string (residual AppSec-R1).

**AUD-032** · LOW · tests — k6/load (§209) ausente; `tests/load` no existe pese a ADR-001 Layout.

**AUD-033** · LOW · UX — redirect/notFound streamed bajo `loading.tsx` devuelve 200 + meta refresh (F2-F5).

**AUD-034** · LOW · aislamiento de tests — suites comparten la DB local y dejan fixtures; flake histórico de `501` por concurrencia de agentes. Esta auditoría añadió fixtures locales al ejecutar integración/E2E.

**AUD-035** · LOW · Master — `R2_errors` en §197; copia Downloads pre-reconciliación.

**AUD-036** · LOW · Netlify legacy — UI del sitio declara build `npm run build` (prevalece `netlify.toml` `pnpm run build`); `managed_dns: true` aunque los nameservers son Vercel.

**AUD-037** · LOW · documentación infra · CONTRADICTION — `docs/RUNIIS_INFRA_SETUP_REPORT.md` afirma "Vercel Project has no `runiismty.com` domain assignment" y "received no copied Netlify runtime secrets"; la API muestra dominios asignados (2026-09-27T07:21Z) y 24 variables sensibles (procedencia UNKNOWN).

### INFO

**AUD-038** — Netlify Scheduled Functions solo corren en deploys publicados de producción (doc Netlify); producción publicada = `main@bdd1198` sin funciones, y los branch deploys no las disparan. FACT: hoy ningún worker HTTP corre en ningún remoto.

**AUD-039** — DNS wildcard `ALIAS *` → Vercel (sistema); `staging.runiismty.com` ya resuelve a Vercel (404).

**AUD-040** — DMARC `p=none`, sin TXT SPF, sin MX; autenticación Brevo por `brevo-code` + DKIM `brevo1/brevo2`.

**AUD-041** — `next-env.d.ts` modificado por `next dev`; no es cambio de producto.

**AUD-042** — Vercel construyó `main` con pnpm 11.8.0 vía `packageManager` aunque la tabla oficial lista pnpm 6–10 (log de build `dpl_8Bzv94…`).

**AUD-043** — Secretos solo en archivos ignorados (`.env.local`, `.env.development.local`, `.env.production.local`, caches `.next`, un log de evidencia T10). Ningún secreto rastreado.

## 9. Recommended Master corrections

No aplicadas (prohibido en esta fase). Propuestas para una fase documental posterior:

1. §3 SUP-010: reemplazar por "Netlify como hosting productivo final: sustituido. Target CLOSED: Vercel (owner 2026-10-01). El plan Vercel debe ser compatible con uso comercial (ver §11)".
2. §10 y §192: Vercel como hosting objetivo; Netlify como legacy hasta cutover validado; gate de producción verifica plan/términos Vercel.
3. §11: añadir la condición explícita de plan comercial en hosting o registrar la excepción decidida por el owner (OWN-01).
4. §14: listar `pg_cron` y `pg_net` como extensiones requeridas si se adopta el scheduler en Supabase.
5. §152: añadir "mecanismo de disparo" por worker y tolerancia de latencia (P0/P1 ≤ minutos).
6. §176: endpoint de webhook neutral o registrar `/api/webhooks/brevo` como adaptador; alinear `/reminders` y `/global-capacity`.
7. §193: sustituir variables Netlify por Vercel (`CRON_SECRET` si aplica); añadir `APP_ENV`, `EMAIL_DELIVERY_MODE`, `EMAIL_ALLOWLIST`; quitar `DEFAULT_WHATSAPP_PHONE_E164` o declararla no usada.
8. §195: incorporar el modelo owner 2026-09-27 y su mapeo Vercel (Production, Preview rama `staging`, local Docker).
9. §197: `R2_errors` → `media_provider_errors`.
10. §200: sustituir "staging" por "verificación local reproducible" según modelo owner.
11. §221: actualizar PEND-INFRA-001/002; añadir PEND-DOMAIN-RENEWAL.
12. §222–§223: marcar como históricos; remitir al Execution Roadmap.
13. Registrar en ADR (no en `.local-state`): SEC-082 ALTCHA, scheduler objetivo, detección de IP por plataforma, política de entornos Vercel.

## 10. OPEN decisions

Ver §6.2 (OPEN-01…OPEN-06).

## 11. OWNER_DECISION items

Ver §6.4 (OWN-01…OWN-07). Las que bloquean la próxima fase técnica: OWN-03 (antes de publicar código) y OWN-01 (antes del cutover, no antes de preparar Preview).

## 12. Readiness conclusion

- Master: suficiente y vigente como autoridad funcional; correcciones de infraestructura y registro de decisiones pendientes (§9). Gate 0 puede declararse formalmente tras esas correcciones.
- Implementación: fundaciones, seguridad de datos, eventos, discovery público, personas, inscripción backend, pases QR, comunicaciones backend y Race Day backend verificados localmente; UI de inscripción/admin/scanner, cierre post-evento y comunidad pendientes; nada desplegado.
- Migración Netlify → Vercel: `NOT_READY` para cutover; preparable sin costo hasta Preview; cutover productivo condicionado a OWN-01 y a los blockers AUD-002, AUD-004, AUD-005, AUD-010.
- Estado de auditoría: `AUDIT_COMPLETE_WITH_OPEN_ITEMS`. La evidencia es suficiente para construir el Execution Roadmap.
