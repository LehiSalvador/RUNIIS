RUNIIS WEB — EXECUTION ROADMAP V1

Estado del documento: Propuesta de Execution Roadmap posterior a Master Audit A0
Fecha base: 2026-10-01
Proyecto: RUNIIS WEB V1
Working directory canónico: C:\PROYECTOS_CLAUDE\RUNIIIS WEB
Project Master Spec canónico: docs\RUNIIS_WEB_SYSTEM_MASTER_SPEC_V2.md
Auditoría maestra: docs\audits\RUNIIS_MASTER_AUDIT_REPORT_V1.md
Baseline técnico: docs\audits\RUNIIS_CURRENT_IMPLEMENTATION_BASELINE_V1.md
Readiness Netlify → Vercel: docs\audits\RUNIIS_NETLIFY_TO_VERCEL_MIGRATION_READINESS_V1.md
Workflow de ejecución: SalvaOps Web Development 1.3.1
Modelo operativo: fresh Claude orchestrator por fase
Agent Pack: 13 especialistas Sonnet 5.5
Estado del proyecto al crear este Roadmap: RUNIIS V1 parcialmente implementado localmente; ninguna URL pública ejecuta todavía V1

0. PROPÓSITO

Este documento define el Execution Roadmap de RUNIIS WEB V1 después de la auditoría maestra A0.

No redefine el producto.

No sustituye el Project Master Spec.

No sustituye ADRs, schemas, contracts, source code ni tests.

No debe utilizarse como fuente de nuevas reglas de negocio cuando el Master ya contiene una decisión CLOSED.

Su función es convertir la definición completa de RUNIIS y el baseline real de implementación en una secuencia mínima de fases ejecutables, verificables, aprobables y reanudables.

El Roadmap está diseñado alrededor de estados que RUNIIS debe alcanzar.

No está diseñado alrededor de los agentes disponibles.

Los agentes concretos, Work Units, Task Envelopes, resource locks y paralelismo interno se generan JIT por el orquestador de cada fase según el estado real del repositorio.

La campaña no debe convertirse en cientos de microfases.

La campaña tampoco debe concentrarse en una única megafase imposible de validar.

Se adoptan cinco fases de ejecución.

La auditoría A0 ya ejecutada no cuenta como fase de implementación.

1. PRINCIPIO ESTRUCTURAL DEL ROADMAP

Decisión de arquitectura CLOSED:

TARGET_PRODUCTION_HOSTING = VERCEL

Netlify deja de ser la arquitectura objetivo.

Netlify representa únicamente:

CURRENT_LEGACY_HOSTING_PENDING_MIGRATION

La migración estructural hacia Vercel comienza en la Fase 1.

A partir del cierre de la Fase 1, todo desarrollo posterior debe realizarse pensando en:

- runtime Vercel;
- Vercel Preview;
- Vercel Production;
- variables separadas por entorno;
- scheduling independiente de Netlify;
- headers portables;
- restricciones reales de Vercel;
- deployment model Vercel;
- observabilidad y providers compatibles con Vercel.

No se permite desarrollar nuevas capacidades sobre Netlify para después migrarlas.

No se permite mantener dos arquitecturas activas de aplicación como estrategia permanente.

Netlify solo puede permanecer temporalmente como rollback o placeholder público hasta que el cutover productivo sea legal, técnicamente seguro y autorizado.

2. JUSTIFICACIÓN DE CINCO FASES

El Roadmap utiliza cinco fases porque es la menor cantidad que permite separar outcomes materialmente distintos y técnicamente aprobables.

Cuatro fases obligarían a fusionar alguno de estos bloques:

- participant journey con staff operations;
- staff operations con community;
- community con release hardening.

Eso produciría una megafase difícil de aislar, verificar y aprobar.

Seis fases añadirían overhead sin necesidad porque la antigua fase exclusiva de migración Vercel se absorbe dentro de la Fase 1.

Las cinco fases son:

FASE 1 — Platform Rebase, Vercel Migration & Authoritative Baseline
FASE 2 — Complete Participant Experience
FASE 3 — Staff Operations, Race Day & Event Closure
FASE 4 — Community, Moderation & Product Completeness
FASE 5 — Production Hardening, Release & Certification

3. BASELINE HEREDADO

La ejecución debe partir del baseline auditado, no de un repositorio vacío.

3.1 Git

Rama local auditada:

staging

HEAD auditado:

a9ef303d36e1ec91eaf0fbffc579d84b2bda5b6c

Estado conocido:

- 21 commits V1 locales por encima de main;
- origin/staging muy atrasado;
- repositorio GitHub público;
- ramas main y staging sin protección;
- GitHub Actions inexistente;
- SalvaOps Code Ledger vacío;
- T41 parcial en working tree sin commit.

3.2 Validaciones locales conocidas

Baseline auditado:

typecheck: PASS
lint: PASS
unit: 463/463 PASS
build: PASS
integration: 60/60 PASS
E2E: 229 PASS / 17 SKIP / 0 FAIL
pgTAP: 32 suites verdes; suite T41 710 falla
gitleaks: ningún secreto real trackeado

3.3 Implementación ya construida y que debe preservarse

No reconstruir salvo finding nuevo demostrado:

- tooling;
- Supabase local;
- esquema físico principal;
- constraints;
- índices;
- RLS;
- RBAC;
- Auth OTP;
- sesiones;
- onboarding base;
- account area;
- Event;
- Edition;
- Modality;
- Category;
- capacity kernel;
- price kernel;
- event configuration APIs;
- routes;
- route revisions;
- GPX backend;
- discovery;
- public event pages;
- public SEO foundation;
- cache invalidation;
- People search;
- Friends;
- Guests;
- guardian relations;
- registration requests;
- holds;
- claims;
- FREE registration backend;
- EXTERNAL_WHATSAPP backend;
- Registration;
- ParticipantPass;
- QR credential crypto;
- replacement/revocation backend;
- communications data model;
- dispatcher;
- Brevo adapter;
- Race Day backend;
- scan backend;
- check-in backend;
- guardian desk backend;
- kit backend;
- lookup backend;
- design system;
- public frontend F1;
- account frontend F2;
- AppSec-R1 remediation SEC-FIX-1.

3.4 Trabajo parcial heredado

T41:

- closure/contracts.ts;
- closure/service.ts;
- four SQL migrations;
- pgTAP 710;
- no API routes;
- no integration suite;
- no evidence;
- no commit;
- pgTAP 710 aborta;
- 711/712 tests ausentes.

Debe conservarse.

No debe asumirse PASS.

3.5 Capacidades principales no implementadas

- Registration UI;
- Admin UI;
- Scanner UI;
- closure operativo completo;
- DistanceCredit verificado;
- rankings;
- snapshots;
- achievements;
- public profiles;
- avatar upload;
- moderation;
- sanctions;
- Task Center;
- integrity scan;
- application observability;
- PostHog integration;
- Sentry integration;
- CI;
- production V1 deployment.

4. MODELO DE EJECUCIÓN POR FASE

Cada fase usa una sesión nueva de Claude.

Claude principal actúa como orquestador.

El orquestador no implementa rutinariamente.

El orquestador:

- lee Master;
- lee Roadmap;
- lee resultado durable de fase anterior;
- verifica baseline;
- genera Phase Packet JIT;
- genera DAG de Work Units;
- calcula dependencias;
- calcula resource conflicts;
- crea Task Envelopes;
- activa solamente especialistas necesarios;
- controla resource locks;
- integra resultados;
- ejecuta Technical Phase Gate;
- produce Phase Report.

Los especialistas:

- son owners de Work Units;
- no lanzan especialistas;
- no redefinen Task Envelope;
- no redefinen Roadmap;
- no redefinen decisiones CLOSED;
- usan contexto JIT;
- usan Skills/tools JIT;
- persisten evidence;
- entregan handoffs compactos.

QA:

- verifica;
- no arregla su propio finding.

AppSec:

- revisa;
- no corrige silenciosamente lo auditado.

Integration & Evidence:

- reconcilia claims con evidence;
- verifica acceptance;
- identifica contradicciones;
- identifica missing evidence.

Human Simulation:

- utiliza el producto como una persona;
- no implementa;
- no corrige;
- no sustituye al Owner Human Gate.

El owner revisa solamente:

- Phase Report;
- resultado observable;
- findings importantes;
- decisiones OWNER_DECISION;
- evidencia relevante cuando haga falta.

Después:

APPROVE
o
REQUEST CHANGES

Solo una fase aprobada se considera PHASE_APPROVED.

5. TESTING Y EVIDENCE

Tier 0:

checks rápidos de Work Unit.

Tier 1:

validación completa de Work Unit.

Tier 2:

Technical Phase Gate.

Tier 3:

release gate de Fase 5.

No se ejecuta la full suite después de cada Work Unit.

No se repite una suite amplia contra el mismo baseline sin cambio que pueda invalidarla.

Evidence pesada se persiste fuera del contexto conversacional.

Los handoffs deben referenciar evidence.

6. REGLAS TRANSVERSALES

6.1 Código existente

No reconstruir código verificado sin finding concreto.

No refactor oportunista.

No reescritura masiva estética.

No cambiar interfaces que ya funcionan salvo requirement demostrado.

6.2 Change Integrity

Todo writer debe revisar:

git status
git diff --stat
git diff --numstat
git diff
git diff --check

Todo churn material debe tener relación con el Work Unit.

6.3 Secrets

No valores de secrets en prompts, handoffs, docs, logs, Git o screenshots.

6.4 Billing

Sin autorización explícita:

- no métodos de pago;
- no upgrade;
- no plan de pago;
- no trial con tarjeta;
- no compra;
- no créditos;
- no add-ons.

6.5 SalvaOps

Operaciones privilegiadas mediante SalvaOps cuando estén cubiertas.

No bypass.

6.6 Contexto

No pasar Master completo a cada agente.

Task Envelope contiene solo contexto necesario.

6.7 Continuidad

Estado durable vive en:

- Master;
- Roadmap;
- ADR;
- schemas;
- source;
- Git;
- Phase Reports;
- approved decisions;
- evidence;
- checkpoints.

No en conversación.

7. FASE 1 — PLATFORM REBASE, VERCEL MIGRATION & AUTHORITATIVE BASELINE

7.1 Propósito

Convertir Vercel en la plataforma real sobre la que se desarrollará y validará todo RUNIIS restante.

Preservar todo trabajo V1 existente.

Corregir autoridad documental.

Eliminar dependencias arquitectónicas de Netlify.

Preparar ambientes, scheduling, CI, secrets, domains y runtime para que ninguna fase posterior necesite una nueva migración de plataforma.

7.2 Outcome observable

Al cerrar Fase 1:

- baseline V1 está protegido;
- Git y fuentes autoritativas son coherentes;
- Master está reconciliado con Vercel;
- documentación durable está versionada;
- Vercel ejecuta la implementación V1 existente;
- staging usa Vercel Preview;
- environments están separados;
- APP_ENV funciona correctamente;
- rate limiting obtiene IP correctamente bajo Vercel;
- workers no dependen de Netlify;
- GPX no viola límites Vercel;
- Supabase Auth redirect model contempla Preview;
- CI existe;
- Netlify deja de ser dependencia del código nuevo;
- Netlify conserva solo rollback/legacy;
- si OWN-01 está resuelta, runiismty.com se mueve a Vercel durante esta fase;
- si OWN-01 no está resuelta, Vercel queda técnicamente preparado y validado, y el único elemento retenido es el cutover público.

7.3 Precondiciones

Antes de comenzar:

- auditoría A0 completa;
- Master disponible;
- Roadmap aprobado;
- OWN-03 resuelta antes de publicar 21 commits V1 a GitHub;
- working tree T41 preservado;
- ninguna limpieza destructiva.

7.4 Protección y autoridad

7.4.1 Preservar baseline

Registrar HEAD, branches, untracked T41, hashes, status, diff y secret scan.

Aislar T41 WIP para evitar que la migración de plataforma lo pierda o modifique accidentalmente.

No mezclar T41 roto con una release.

7.4.2 Resolver respaldo remoto

Después de OWN-03:

- publicar baseline de forma segura;
- proteger ramas;
- capturar history;
- verificar remote.

7.4.3 Corregir autoridad documental

Reconciliar:

AGENTS.md
CLAUDE.md
SalvaOps Knowledge
Master real
ADR-001
Roadmap

El placeholder SalvaOps no puede continuar siendo MASTER autoritativo.

7.4.4 Promover specs durables

Versionar Threat Model T11, UX Spec T12 y UI Spec T13.

Preservar su contenido.

7.4.5 Reconciliar Master

Aplicar patches de auditoría:

- Vercel target;
- Netlify legacy;
- Cloudinary terminology;
- APP_ENV;
- EMAIL_DELIVERY_MODE;
- EMAIL_ALLOWLIST;
- environments;
- worker trigger mechanism;
- media_provider_errors;
- Supabase staging semantics;
- orchestration sections historical;
- implementation order historical;
- pending domain status.

Registrar ADR/amendment para hosting, scheduler, IP detection, environment model, ALTCHA y decommission de Netlify.

7.5 Normalización del proyecto Vercel

Auditar antes de mutar:

- project;
- Git integration;
- production branch;
- auto-deploy;
- domains;
- env metadata;
- framework;
- Node;
- pnpm;
- deployments.

Después normalizar.

Build model:

framework = Next.js
Node = versión compatible del repo
pnpm = packageManager del repo
build = pnpm run build
output = Vercel-native Next.js

No usar Netlify Next adapter.

7.6 Modelo definitivo de ambientes

Local:

Next local.
Supabase Docker.
Mailpit.
EMAIL_DELIVERY_MODE=capture.

Staging:

Git staging
→ Vercel Preview
→ staging.runiismty.com
→ backend no productivo
→ allowlist/capture email.

Generic Preview:

no production DB.
no production server secrets.
EMAIL_DELIVERY_MODE=capture.

Production:

main
→ Vercel Production
→ runiismty.com
→ Supabase production.

7.7 Environment parity

Separar Vercel Production y Preview.

Requeridas según uso:

APP_ENV
APP_BASE_URL
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY
PASS_CREDENTIAL_ENCRYPTION_KEY_V1
INTERNAL_CRON_SECRET
EMAIL_DELIVERY_MODE
EMAIL_ALLOWLIST
BREVO_API_KEY
BREVO_WEBHOOK_AUTH_SECRET
BREVO_SENDER_EMAIL
BREVO_SENDER_NAME
NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME
CLOUDINARY_API_KEY
CLOUDINARY_API_SECRET
NEXT_PUBLIC_POSTHOG_KEY
NEXT_PUBLIC_POSTHOG_HOST
NEXT_PUBLIC_SENTRY_DSN
SENTRY_ORG
SENTRY_PROJECT
SENTRY_AUTH_TOKEN cuando aplique

No documentar values.

7.8 Preview Supabase

OPEN-02 debe resolverse dentro de la fase.

Vercel Preview nunca utiliza Supabase production.

Opción preferente si es viable:

Supabase staging remoto existente como backend de Preview.

Confirmar autoridad, migrations, datos no productivos y secrets propios.

Si SalvaOps soporta environment bindings, mapear development/staging/production.

7.9 Código específico de Netlify

7.9.1 Client IP

Eliminar dependencia exclusiva de x-nf-client-connection-ip.

Crear resolución portable de IP.

Probar separación de buckets y resistencia al spoofing.

7.9.2 Workers

Eliminar Netlify Scheduled Functions como scheduler.

Mecanismo preferente:

Supabase pg_cron
+
pg_net
+
authenticated POST
+
worker routes Vercel

Cubrir:

outbox-dispatch
issue-pending-credentials
communication-reconcile
provider-usage-reconcile

y dejar arquitectura utilizable por workers futuros.

Requisitos:

Vault;
secret por entorno;
Bearer auth;
retry;
idempotency;
worker_run evidence.

7.9.3 Cleanup Netlify

No retirar dependencias antes de probar sustitutos.

Después:

retirar netlify/functions;
@netlify/functions;
@netlify/plugin-nextjs;
netlify.toml;
config específica.

Mantener deployment legacy para rollback.

7.9.4 GPX

Resolver límite de body Vercel.

Preservar capacidad funcional.

No limitar arbitrariamente sin justificar.

Probar límite real.

7.10 Auth y URLs

Configurar redirects de Supabase para Production y Preview.

Verificar Google OAuth, OTP callback, APP_BASE_URL, same-origin, CSP, email links, pass links, canonical, sitemap y robots.

7.11 Email safety

Preview usa allowlist/capture.

Production live solo cuando corresponda.

Verificar Authorized IP behavior de Brevo.

7.12 CI

Crear GitHub Actions:

install reproducible;
lint;
typecheck;
unit;
DB tests adecuados;
integration;
build;
secret scan.

No full Tier 3 por cada push.

7.13 Vercel staging real

staging.runiismty.com debe ejecutar la aplicación V1 real.

No placeholder.

No se exige que las features de fases futuras existan.

Sí se exige estabilidad de plataforma.

7.14 Cutover temprano del dominio

Objetivo:

mover runiismty.com a Vercel durante Fase 1 para que todas las fases posteriores trabajen sobre arquitectura final.

Precondición:

OWN-01 resuelta de forma compatible con términos de Vercel y política financiera del owner.

Si OWN-01 sigue abierta:

- no violar términos;
- no ejecutar cutover comercial;
- continuar Vercel Preview;
- todo desarrollo nuevo sigue siendo Vercel-first;
- Netlify mantiene solo placeholder público.

7.15 Gate técnico Fase 1

Debe demostrar:

- baseline protegido;
- authority correcta;
- specs durables versionadas;
- Vercel build PASS;
- Vercel Preview PASS;
- env separation PASS;
- health correcto;
- client IP tests;
- rate limit tests;
- worker trigger test;
- no scheduler duplicado;
- Preview DB isolation;
- OAuth redirects;
- Brevo safety;
- GPX compatible;
- CI PASS;
- no tracked secrets;
- no nueva dependencia activa de Netlify;
- rollback documentado.

Si hubo cutover:

- runiismty.com en Vercel;
- www → apex;
- TLS válido;
- health correcto;
- Netlify rollback viable.

7.16 Owner Human Gate Fase 1

Owner revisa staging.runiismty.com y el Phase Report.

Resultado:

PHASE_1_APPROVED

7.17 No objetivos

No completar todavía Registration UI, Admin, Scanner, T41, rankings, avatars, sanctions o Task Center completo.


8. FASE 2 — COMPLETE PARTICIPANT EXPERIENCE

8.1 Propósito

Cerrar el North Star del participante.

Una persona debe poder recorrer RUNIIS desde descubrimiento hasta inscripción confirmada y pase sin herramientas internas.

Todo debe ejecutarse sobre la plataforma Vercel establecida en Fase 1.

8.2 Outcome observable

Un participante puede:

- abrir RUNIIS;
- explorar eventos;
- filtrar;
- abrir Event page;
- iniciar sesión;
- completar onboarding;
- aceptar requisitos legales;
- seleccionar participantes;
- seleccionar modalidad;
- responder formularios;
- obtener precio;
- completar FREE o EXTERNAL_WHATSAPP;
- comprender hold y expiry;
- ver confirmación;
- ver Registration;
- ver ParticipantPass;
- ver QR;
- gestionar solicitudes y preferencias.

8.3 Revalidación heredada

Antes de nueva UI, verificar sobre Vercel:

Home.
Event library.
Event page.
SEO público.
Login.
OTP.
Google OAuth.
Onboarding.
Cuenta.
Friends.
Guests.
Guardian.
Requests page.
Passes.

No reconstruir F1/F2 heredados.

Corregir solamente incompatibilidades observadas.

8.4 Legal acceptance

OWN-05 debe estar suficientemente resuelta.

Registrar:

document type;
version;
actor;
accepted_at;
context;
current required version.

Onboarding debe registrar aceptación según decisión final.

Registration debe verificar requisitos legales aplicables.

Legal pages públicas deben resolver versiones correctas.

8.5 Registration route

Implementar:

/inscripcion/[slug]

Eliminar CTA rota.

Debe recuperar:

Edition;
modalities;
availability;
price;
form;
eligibility.

No duplicar autoridad en browser.

8.6 Participant builder

Soportar:

SELF
FRIEND
GUEST
MINOR

SELF:

cuenta actual.

FRIEND:

relationship aceptada según reglas.

GUEST:

owned by buyer;
sin community;
sin credits;
sin ranking;
archive futuro.

MINOR:

15–17;
guardian account;
guardian requirement;
verificación presencial el día del evento.

No permitir combinaciones inválidas.

8.7 Modality y Category

El cliente consulta backend.

Backend revalida.

No confiar en selections stale.

Availability y price son derivados server-side.

8.8 Dynamic forms

Render desde configuración del evento.

Requerimientos:

- tipos de campo correctos;
- validación;
- required;
- conditional cuando exista;
- labels accesibles;
- error mapping;
- server validation;
- preserved input on recoverable failures.

8.9 FREE journey

Secuencia:

request/transaction según contrato;
revalidation;
capacity lock;
confirm;
Registration;
ParticipantPass;
credential;
confirmation.

No crear Payment.

No introducir fake payment state.

8.10 EXTERNAL_WHATSAPP journey

Secuencia:

request;
hold;
absolute expires_at;
instructions;
WhatsApp contact;
pending state;
account view;
staff confirmation posterior.

La UI debe distinguir:

REQUEST
HOLD
REGISTRATION

No presentar request como inscripción.

8.11 Expiry

expires_at es authoritative.

Probar:

- countdown;
- server refresh;
- browser reload;
- back;
- close/reopen;
- expiry between steps;
- hold lost;
- all slots temporarily held;
- request cancellation.

8.12 Concurrency

Probar:

last slot;
two users;
global capacity;
modality capacity;
hold versus confirmed Registration.

No mutable available_slots.

8.13 Minor journey

Probar:

guardian relation missing;
guardian present;
guardian different account;
invalid age;
adult no requiere spot pagado;
public competition restrictions.

8.14 Guest journey

Create/select guest.

Registration.

Pass donde aplique.

No DistanceCredit.

No ranking.

No public profile.

8.15 Communications participant

Confirmations.

Requests.

Pass-related email.

Reminder confirmation.

Consent management.

Unsubscribe donde corresponda.

Preview/staging delivery debe seguir siendo segura.

8.16 Pass UI

Mostrar:

event;
participant;
status;
credential;
QR;
replacement state.

Revoked credential no valida.

Replacement crea nueva credential, no segundo logical pass.

8.17 UX states

Implementar:

loading;
empty;
error;
success;
expired;
temporarily unavailable;
network error;
retry;
session expired;
permission denied;
validation errors.

8.18 Responsive

Mobile first.

Validar:

small width;
large width;
touch targets;
keyboard;
focus;
reduced motion.

8.19 Accessibility

WCAG 2.2 AA target.

Forms:

labels;
errors;
aria relationships;
focus movement;
live status cuando sea necesario.

8.20 Security

Verificar:

server authority;
session cookies;
origin;
rate limits;
no PII leak;
participant ownership;
guest ownership;
minor authorization;
Friend authorization;
no cross-account request access.

8.21 Testing Tier 0/1

Cada Work Unit ejecuta pruebas específicas.

Ejemplos:

- component/unit;
- validation schema;
- route handler;
- targeted E2E;
- scoped accessibility;
- targeted security.

No ejecutar full suite tras cada componente.

8.22 Technical Gate Fase 2

Required journeys:

Adult FREE.
Adult WhatsApp.
Friend.
Guest.
Minor.
Expired hold.
Last slot race.
Invalid form.
Legal acceptance.
Session recovery.
Pass display.
Credential replacement cuando esté expuesto.
Communication preference.
Mobile.
Keyboard.

Validación:

Tier 2;
browser console;
network;
accessibility;
targeted AppSec;
Integration & Evidence.

8.23 Evidence mínima

Debe existir evidencia para:

- registration success;
- expiry;
- capacity race;
- participant type rules;
- pass issuance;
- QR state;
- legal acceptance;
- permissions;
- mobile behavior;
- accessibility.

8.24 Owner Human Gate Fase 2

Owner debe poder:

abrir staging;
seleccionar evento;
sign in;
completar inscripción;
ver confirmación;
ver pase.

Si experiencia no representa RUNIIS:

REQUEST_CHANGES.

8.25 Criterio de salida

PHASE_2_APPROVED requiere:

- registration UI funcional;
- no CTA rota;
- participant journey completo;
- legal acceptance aplicada;
- FREE y WhatsApp correctos;
- pass/QR correcto;
- minors/Guests/Friends correctos;
- Tier 2 PASS;
- Integration & Evidence READY;
- owner APPROVE.

8.26 No objetivos

No construir todavía:

- full Admin;
- scanner;
- closure;
- rankings;
- avatar moderation;
- full Task Center.

9. FASE 3 — STAFF OPERATIONS, RACE DAY & EVENT CLOSURE

9.1 Propósito

Permitir que RUNIIS staff opere un evento de principio a fin sin SQL, Postman, Supabase Dashboard ni comandos manuales.

Completar T41.

Construir Admin y Scanner.

Cerrar el ciclo operativo de evento.

9.2 Outcome observable

Staff puede:

create;
configure;
publish;
manage registrations;
handle external requests;
manage kits;
scan;
verify guardians;
check in;
resolve attendance;
resolve eligibility;
finalize;
close;
reopen/correct.

9.3 T41 recovery

Partir del WIP preservado.

No rediseñar.

Primero:

- inspeccionar checkpoint;
- inspeccionar migration order;
- decidir si timestamps T41 deben renumerarse;
- corregir pgTAP 710;
- escribir 711;
- escribir 712;
- verificar suites previas verdes.

Luego implementar APIs e integración.

9.4 AttendanceResolution

Commands y API para:

present;
absent;
special cases definidas por Master;
evidence;
actor;
audit.

Check-in es evidence, no final attendance.

9.5 SportingEligibilityResolution

Separada de attendance.

Persistir:

decision;
reason;
actor;
timestamp;
evidence.

9.6 Attendance universe

Construir universo correcto.

Excluir Guest de DistanceCredit.

Respetar Registration cancellation.

Respetar modality change.

9.7 AttendanceFinalization

Readiness.

Bloquear si existen resoluciones obligatorias pendientes.

Versionar cuando corresponda.

9.8 AdministrativeClosure

Cerrar solo después de readiness.

Generar DistanceCredit exactly once.

Usar official modality distance.

Preservar historical truth.

9.9 DistanceCredit

Ledger fact.

No mutable total_km como source of truth.

Exactly-once.

Corrections/reopen producen historial auditable.

9.10 Reopen

Controlled.

Staff authority.

Audit.

Invalidar/recalcular derivados según contrato.

No silent rewrite.

9.11 Registration cancellation

OWN-04 debe estar resuelta.

Aplicar política a:

Registration;
capacity;
Pass;
kit;
check-in;
attendance;
closure.

No comportamiento implícito.

9.12 Change modality

Validar:

new capacity;
price implications;
event state;
kit implications;
Pass implications;
distance implications.

9.13 Admin shell

Reemplazar placeholder por rutas reales.

Navegación basada en role.

Seguridad real en backend.

9.14 Event management

Superficies staff:

Events;
Editions;
modalities;
categories;
prices;
capacity;
forms;
locations;
agenda;
content;
media reference;
schedule revisions;
status transitions.

9.15 Readiness UI

Antes de publish:

mostrar faltantes.

No permitir publish inválido.

9.16 Route editor

Staff puede:

select route;
import GPX;
inspect route;
revision;
start/finish;
POI;
validation;
publish revision.

Debe usar arquitectura GPX compatible con Vercel de Fase 1.

9.17 External request queue

Staff puede:

list;
filter;
inspect;
confirm;
reject/cancel cuando corresponda;
ver expiry;
ver hold;
ver participant;
ver WhatsApp state.

Confirm crea Registration atómicamente.

9.18 Participant administration

Search participant.

Inspect:

account/guest/minor;
Registration;
Pass;
kit;
check-in;
attendance.

Respetar PII permissions.

9.19 Kits

Operational workflow:

prepared;
assigned;
delivered;
missing;
participant lookup;
race-day update.

9.20 Scanner

Implementar /scanner.

Soportar:

camera;
manual fallback donde sea requerido;
credential validation;
revoked;
unknown;
wrong Edition;
duplicate;
already checked-in;
kit state;
minor guardian requirement;
network failure;
retry.

9.21 Guardian desk

Staff verifica relación adulto-menor presencialmente.

Registrar evidence.

Adult no requiere Registration.

9.22 Check-in

Persistir evidence.

Idempotency.

No convertir automáticamente check-in en attendance final.

9.23 Attendance desk

Staff resuelve asistencia real.

Mostrar exceptions.

Permitir operación eficiente para listas grandes si Master lo admite.

9.24 Finalization UI

Mostrar:

readiness;
unresolved attendance;
eligibility;
integrity blockers;
finalize action.

9.25 Closure UI

Mostrar:

closure readiness;
blocking cases;
DistanceCredit summary;
closure action;
reopen/correction.

9.26 Basic Task Center

Implementar mínimo operacional:

attendance pending;
closure pending;
communication failure;
provider reconciliation;
integrity issue.

Task apunta a root object.

Task no es source of truth.

9.27 RBAC

Probar cada superficie con:

ADMIN
OPERATOR
CHECKIN
MODERATOR

Probar:

UI;
direct URL;
API;
session role change;
forbidden mutation.

9.28 UX operativa

Admin debe priorizar:

clarity;
speed;
error recovery;
high-density information;
keyboard where useful;
mobile/tablet where race-day lo requiera.

Scanner debe ser usable bajo condiciones reales de evento.

9.29 Error handling

Staff debe recibir errores accionables.

No exponer raw SQL/error interno.

Distinguish:

validation;
permission;
conflict;
capacity;
stale state;
provider;
network.

9.30 Technical Gate Fase 3

Simulación operativa completa:

create Edition
→ configure
→ publish
→ registration
→ request confirmation
→ kit
→ scan
→ guardian
→ check-in
→ attendance
→ eligibility
→ finalize
→ close
→ DistanceCredit

Negative paths:

wrong role;
duplicate scan;
revoked QR;
wrong event;
capacity issue;
closure blocked;
reopen;
cancel;
change modality.

9.31 Database Gate

pgTAP T41 completo.

Concurrency close_edition.

Exactly-once DistanceCredit.

Reopen/correction.

No regressions de suites previas.

9.32 Security Gate

Targeted AppSec para:

admin;
scanner;
PII;
RBAC;
IDOR;
closure commands;
guardian evidence;
QR validation.

9.33 Evidence mínima

Debe existir evidence de:

- T41 tests;
- admin role boundaries;
- scanner scenarios;
- closure lifecycle;
- DistanceCredit;
- request queue;
- kit flow;
- guardian flow.

9.34 Owner Human Gate Fase 3

Owner opera un evento sintético como staff.

Debe poder completar ciclo sin herramientas internas.

Resultado:

PHASE_3_APPROVED
o
REQUEST_CHANGES.

9.35 Criterio de salida

Fase 3 PASS requiere:

- T41 completo;
- Admin funcional;
- Scanner funcional;
- event lifecycle operable;
- request queue;
- kits;
- guardian desk;
- attendance;
- closure;
- credits;
- RBAC;
- Tier 2 PASS;
- Integration & Evidence READY;
- owner APPROVE.

9.36 No objetivos

No completar todavía:

- rankings;
- achievements;
- public profiles;
- avatar moderation;
- sanctions completas;
- final observability release.


10. FASE 4 — COMMUNITY, MODERATION & PRODUCT COMPLETENESS

10.1 Propósito

Completar la capa comunitaria y competitiva que depende de participación deportiva verificada.

Cerrar los dominios T42, T36 y T43.

Completar perfiles públicos, rankings, achievements, avatar/moderation, sanctions, Task Center, integrity, analytics y observability de aplicación.

Al terminar esta fase, RUNIIS V1 debe estar funcionalmente completo.

10.2 Outcome observable

Un evento cerrado produce correctamente:

final attendance
→ DistanceCredit
→ ranking projection
→ official snapshot
→ achievements
→ public profile
→ home podium

El sistema además puede:

- gestionar avatar;
- moderar contenido;
- sancionar/bloquear cuentas según reglas;
- detectar integrity cases;
- generar tareas operativas;
- observar errores;
- registrar analytics aprobados.

10.3 Ranking source of truth

Rankings derivan de DistanceCredit.

No derivan de:

- Registration;
- Payment;
- hold;
- QR scan aislado;
- check-in aislado.

10.4 Ranking periods

Implementar:

weekly;
monthly;
historical.

Definir y respetar:

period start;
period end;
open;
closing;
closed;
snapshot;
correction behavior.

10.5 Live projection

Puede existir una proyección optimizada.

Debe ser reconciliable con ledger.

No puede convertirse en source of truth independiente.

10.6 Tie rule

Usar competition ranking.

Test:

single tie;
multiple tie groups;
first-place tie;
next rank after tie;
historical reconstruction.

10.7 Monthly snapshot

Crear snapshot oficial al cierre.

Snapshot no debe cambiar silenciosamente.

Correcciones posteriores siguen protocolo de reopen/recompute definido.

10.8 Historical cut

Definir corte histórico según Master.

Mantener reproducibilidad.

10.9 Achievements

Implementar al menos:

MONTHLY_PODIUM
HISTORICAL_PODIUM_CUT

Garantizar:

idempotency;
no duplicate achievement;
correct participant eligibility;
minor restrictions;
correction behavior.

10.10 Home community

Mostrar:

Top 3 monthly.
Top historical según definición.

Estados:

no data;
ties;
loading;
error.

No exponer minors fuera de política.

10.11 Ranking public route

Implementar:

/ranking

Soportar:

weekly;
monthly;
historical;
period navigation cuando aplique.

SEO.

Responsive.

Accessibility.

10.12 Public profile

Implementar:

/personas/{id}

Allowlist de campos públicos.

Mostrar según reglas:

display name;
avatar;
km;
achievements;
podium markers;
event history únicamente si Master lo permite.

No exponer:

phone;
email;
emergency contact;
private legal data;
guardian private data.

10.13 Searchability

Respetar reglas adult/minor.

Menores:

no entrar en búsquedas públicas cuando decisión vigente lo prohíba.

Guardian nunca debe convertirse en perfil público por relación.

10.14 Avatar architecture

Implementar Cloudinary signed upload.

Flujo preferente:

browser
→ request signature
→ direct Cloudinary upload
→ app stores controlled media reference
→ moderation pipeline

No enviar archivos de imagen grandes innecesariamente a Vercel server.

10.15 Avatar validation

Validar:

owner;
mime;
size;
dimensions cuando aplique;
transformation policy;
Cloudinary folder;
public URL policy.

10.16 Avatar lifecycle

Estados según contrato.

Debe poder:

upload;
pending moderation;
approve;
reject;
replace;
delete;
cleanup orphan.

10.17 Event media

El Master también contempla media de evento.

Si sigue ausente, completar usando la misma abstracción de provider donde sea correcto.

No mezclar reglas de moderación de avatar con media editorial salvo que corresponda.

10.18 Moderation

MODERATOR puede:

ver queue;
inspeccionar contenido;
approve;
reject;
registrar reason.

Audit trail.

10.19 Sanctions

Completar T36:

sanction commands;
ban;
unban;
identity restrictions;
public visibility effects;
audit.

Resolver M-AMB-03:

qué ocurre con sesiones activas al ban.

Si la resolución modifica arquitectura/security contract:

ADR durable.

10.20 Blocked identity

Preservar existing auth hook.

Asegurar consistencia entre:

new signup;
existing account;
active session;
ban;
unban.

10.21 Task Center completo

Extender basic Task Center de Fase 3.

Agregar reglas para:

attendance;
closure;
ranking;
snapshot;
integrity;
communications;
provider;
avatar;
workers;
cleanup;
operational reconciliation.

Cada task:

root object;
type;
severity/priority según contract;
status;
created_at;
resolved_at;
resolution link/evidence.

10.22 IntegrityCase

Implementar comandos/procesos.

Detectar:

closure inconsistencies;
DistanceCredit anomalies;
ranking drift;
snapshot issues;
orphan media;
other Master-defined cases.

No aplicar auto-repair destructivo sin contrato.

10.23 Ranking period manager

Worker debe:

open/close periods;
trigger projection/snapshot according to contract;
be idempotent;
record worker run;
recover after failure.

10.24 Ranking projection refresh

Implementar worker.

No recalcular todo sin necesidad si incremental architecture es viable.

Correctness tiene prioridad.

10.25 Avatar processing worker

Procesar pending lifecycle según design.

Idempotent.

10.26 Orphan cleanup

No borrar media activa.

Safe retention window.

Audit/evidence cuando corresponda.

10.27 Integrity scan worker

Periodic.

Creates cases/tasks.

No silently mutates authoritative sporting data unless explicitly allowed.

10.28 Observability application

Integrar Sentry.

Server.

Client cuando corresponda.

Environment tag.

Release tag.

Source maps si se autoriza.

Scrubbing de PII.

No enviar secrets.

10.29 Analytics

Integrar PostHog según Master.

No autocapture indiscriminado si viola privacy intent.

No session replay salvo decisión explícita.

No PII.

Eventos útiles:

event_view;
registration_start;
registration_complete;
request_created;
pass_view;
other approved product signals.

10.30 Environment analytics

Separar staging/production.

No mezclar métricas sin tag.

10.31 SEO community

Completar:

/ranking
/personas/{id}

Canonical.

Metadata.

OG.

Sitemap inclusion cuando corresponda.

Robots.

Structured data solo cuando semánticamente válido.

Staging no indexable.

10.32 Community accessibility

Rankings no deben depender exclusivamente de posición/visual.

Podium readable.

Avatar alt.

Table/list semantics.

Keyboard.

10.33 Performance

Ranking queries deben usar indexes/materialization apropiada.

No N+1 profile rendering.

Public home should preserve Master budgets.

10.34 Full V1 requirement reconciliation

Antes del Gate de Fase 4, construir trazabilidad:

Master requirement
→ implementation
→ test
→ evidence
→ status.

Todo requirement V1 debe quedar:

IMPLEMENTED
o
BLOCKED_EXTERNAL con razón legítima.

No puede quedar olvidado porque no pertenecía a un antiguo T-ID.

10.35 Technical Gate Fase 4

Scenario principal:

closed event
→ DistanceCredit
→ ranking projection
→ official snapshot
→ achievement
→ public profile
→ Home podium

Scenarios adicionales:

weekly;
monthly;
historical;
ties;
reopen/correction;
Guest exclusion;
minor privacy;
avatar approval;
avatar reject;
avatar replace;
sanction;
ban/unban;
Task Center;
IntegrityCase;
worker recovery;
Sentry smoke;
PostHog controlled event.

10.36 Security Gate

AppSec dirigido a:

public profile;
PII;
searchability;
avatar upload;
Cloudinary signature;
moderation;
ban;
admin tasks;
analytics privacy.

10.37 QA Gate

Independent.

No QA self-fix.

10.38 Evidence mínima

Debe existir:

ranking tests;
snapshot tests;
achievement tests;
privacy tests;
avatar lifecycle;
moderation;
sanction;
Task Center;
workers;
observability smoke;
analytics smoke.

10.39 Owner Human Gate Fase 4

Owner revisa:

Home community.
Ranking.
Profile.
Achievements.
Avatar.
Moderation.
Task Center.

Después de APPROVE:

RUNIIS V1 se considera funcionalmente completo.

No se considera todavía production-certified.

10.40 Criterio de salida

PHASE_4_APPROVED requiere:

- T42 completo;
- T36 completo;
- T43 completo;
- public community;
- privacy;
- workers;
- Sentry integrated;
- PostHog integrated;
- Master traceability complete;
- Tier 2 PASS;
- Integration & Evidence READY;
- owner APPROVE.

11. FASE 5 — PRODUCTION HARDENING, RELEASE & CERTIFICATION

11.1 Propósito

Convertir RUNIIS V1 funcionalmente completo en una release de producción segura, observable, recuperable y aprobada.

No introducir nuevas features salvo remediation necesaria para release.

11.2 Outcome observable

https://runiismty.com

ejecuta RUNIIS V1 sobre Vercel con:

- production Supabase;
- Auth real;
- email real;
- media real;
- workers;
- observability;
- CI;
- backups;
- security;
- accessibility;
- performance;
- SEO;
- full regression;
- Human Simulation PASS;
- owner RELEASE_APPROVED.

11.3 Definition freeze de release

Antes de Tier 3:

no abrir features nuevas.

Solo:

bug fix;
security fix;
release blocker;
legal required fix;
provider compatibility fix.

11.4 OWNER_DECISION closure

Resolver toda decisión que bloquee producción.

11.4.1 OWN-01

Plan Vercel compatible con uso comercial o confirmación formal válida.

No operar comercialmente sobre un plan que lo prohíba.

No realizar pago automáticamente.

11.4.2 OWN-02

Renovación de dominio.

Documentar decisión antes de expiry.

No cobrar automáticamente.

11.4.3 OWN-04

Cancellation debe estar cerrada desde Fase 3.

11.4.4 OWN-05

Legal acceptance debe estar cerrada desde Fase 2.

11.4.5 OWN-06

Definir RPO y RTO.

11.4.6 OWN-07

Legal final.
WhatsApp real.
Brand pending si todavía existe.

11.5 Supabase production read-only verification

Antes de migrations:

verificar:

project ref;
current migrations;
schema;
Auth;
redirects;
SMTP;
Google;
policies;
extensions;
jobs;
Vault.

No asumir estado histórico.

11.6 Production migrations

Aplicar por path autorizado.

Después:

migration verification.

No considerar PASS porque command accepted.

11.7 Schema/RLS verification

Comparar local expected versus production actual.

Verificar:

tables;
columns;
constraints;
indexes;
functions;
policies;
grants.

11.8 Auth production

Verificar:

OTP digits;
OTP expiry;
resend cooldown;
before_user_created hook;
blocked identity;
Google;
redirect allowlist;
Site URL;
SMTP.

11.9 Production workers

Verificar:

pg_cron;
pg_net;
Vault secret;
target URL;
auth;
infra.worker_run;
no duplicate scheduler.

11.10 Bootstrap first ADMIN

Ejecutar bootstrap one-shot autorizado.

Verificar role.

Audit.

No dejar endpoint permanente inseguro.

11.11 Legal final

Insert current legal documents.

Versions.

Publish.

Acceptance points.

11.12 WhatsApp operational

Configure official phone in authoritative source.

No env duplicate if platform_settings is source.

Document staff operation.

11.13 Brevo production

Verify:

API key availability;
SMTP;
sender;
domain;
DKIM;
DMARC;
webhook;
authorized IP policy;
quota;
suppression.

EMAIL_DELIVERY_MODE=live únicamente Production.

Controlled transactional test.

No mass campaign.

11.14 Email capacity

OPEN-04.

Brevo free 300/day puede ser insuficiente.

Clasificar:

current capacity;
expected event peak;
OTP demand;
transactional demand;
campaign demand.

Si capacidad paga es necesaria:

financial blocker.

No upgrade automático.

11.15 Cloudinary production

Controlled signed upload.

Transformation.

Moderation.

Delete.

No secret exposure.

11.16 Sentry production

Controlled error event.

Correct environment.

Correct release.

Source maps if configured.

PII scrub.

11.17 PostHog production

Controlled analytics event.

Correct environment.

No PII.

11.18 Backup strategy

OWN-06.

Definir:

RPO;
RTO;
backup;
export;
restore steps;
responsible system;
frequency;
retention.

11.19 Restore test

Ejecutar restore drill en entorno seguro.

Demostrar que backup es utilizable.

No considerar backup PASS sin restore test.

11.20 CI release protection

GitHub Actions green.

Branch protection.

Required checks según política.

No merge release con failing checks.

11.21 Load testing

Crear/usar k6 o equivalente.

Scenarios mínimos:

registration peak;
last slot race;
availability;
OTP rate limit;
worker batch;
scanner/check-in concurrency cuando corresponda;
closure contention.

No apuntar carga destructiva a producción si no es seguro.

Usar entorno apropiado y extrapolar con cuidado.

11.22 Performance

Medir host real Vercel.

LCP.
INP.
CLS.
public JS.
SSR.
ISR.
API latency.

Comparar con targets del Master.

11.23 Accessibility

Automated plus manual.

WCAG 2.2 AA target.

Keyboard.

Focus.

Forms.

Scanner where applicable.

11.24 SEO

Production crawl.

Canonical.

www redirect.

robots.

sitemap.

structured data.

OG.

No staging index.

11.25 AppSec Tier 3

Independent AppSec.

Scope:

Auth;
sessions;
RLS;
RBAC;
IDOR/BOLA;
CSRF/origin;
rate limiting;
CSP;
headers;
cookies;
webhooks;
workers;
QR;
uploads;
media;
PII;
admin;
scanner;
public profiles;
ban;
Preview isolation;
secrets.

Reverify SEC-FIX-1 independently.

11.26 QA Tier 3

Full regression:

public;
account;
registration;
admin;
race-day;
closure;
community.

11.27 Environment isolation

Production:

production DB;
production secrets;
live email.

Preview:

non-production DB;
non-production secrets;
allowlist/capture.

Generic preview:

no production data.

11.28 Release candidate

Freeze exact:

commit SHA;
migration set;
env state;
provider state;
configuration.

No "latest random main".

11.29 Production deploy

Si runiismty.com ya migró a Vercel en Fase 1:

promover/deploy exact release candidate.

Si cutover se retuvo por OWN-01:

ejecutar ahora según runbook validado de Fase 1.

11.30 DNS/canonical verification

Apex = primary.

www → apex.

Preserve:

Brevo verification;
DKIM;
DMARC;
CAA;
other required records.

11.31 Immediate production smoke

Check:

/
api/health
/eventos
event detail
robots
sitemap
OTP
Google OAuth
controlled Registration
Pass
QR
Admin
Scanner
worker
email
Cloudinary
Sentry
PostHog

11.32 Release monitoring

Observe:

5xx;
Auth failure;
worker gaps;
email failure;
CSP reports;
provider errors;
rate limit anomalies.

11.33 Integration & Evidence final

Reconstruir:

Master
→ Roadmap
→ implementation
→ tests
→ evidence
→ production state.

Allowed outcomes:

READY
NOT_READY
CONTRADICTION
EVIDENCE_MISSING

Solo READY pasa a Human Simulation final.

11.34 Human Simulation

Último agente técnico.

Debe usar producción como persona real.

Journeys:

visitor;
search;
event;
login;
onboarding;
adult registration;
friend;
guest;
minor;
pass;
ranking;
profile;
staff;
admin;
request queue;
kit;
scanner;
guardian;
check-in;
attendance;
finalization;
closure;
Task Center;
moderation;
errors;
mobile;
keyboard;
reload;
back;
session expiry;
network degradation.

No implementa.

No corrige.

11.35 Finding loop

FAIL:

finding
→ orchestrator
→ specialist owner
→ remediation
→ affected Tier tests
→ Integration & Evidence cuando aplique
→ redeploy
→ Human Simulation again

Repetir hasta PASS.

11.36 Rollback

Rollback triggers:

health != healthy;
sustained 5xx;
OTP failure;
OAuth callback failure;
workers not executing;
P0 email failure;
CSP breaks own scripts;
invalid certificate;
critical security regression.

If Netlify still available and rollback plan valid:

restore according to runbook.

Application state remains in Supabase and must be handled carefully.

11.37 Netlify decommission

No eliminar apenas Vercel funciona.

Decommission only after:

production stable;
Auth stable;
workers stable;
email stable;
observability stable;
rollback window passed;
release policy allows.

Retirar:

custom domain;
Git integration;
env;
site;
deploy hook;
remaining config.

11.38 Owner Human Gate final

Owner usa runiismty.com real.

Allowed:

RELEASE_APPROVED
REQUEST_CHANGES

Only RELEASE_APPROVED closes campaign.

11.39 Criterio de salida

PHASE_5_APPROVED / RELEASE_APPROVED requiere:

- all production blockers resolved or explicitly accepted where legally/technically possible;
- production Vercel;
- production Supabase verified;
- providers verified;
- CI green;
- Tier 3 green;
- AppSec PASS;
- QA PASS;
- accessibility PASS;
- performance PASS;
- SEO PASS;
- backup/restore PASS;
- Integration & Evidence READY;
- Human Simulation PASS;
- owner APPROVE.

12. DEPENDENCIAS ENTRE FASES

Fase 1 bloquea Fase 2 porque toda nueva UI debe construirse en la arquitectura Vercel final.

Fase 2 bloquea Fase 3 porque staff operations deben poder consumir registrations reales del participant journey.

Fase 3 bloquea Fase 4 porque rankings dependen de final attendance y DistanceCredit.

Fase 4 bloquea Fase 5 porque release certification debe cubrir el V1 completo.

No ejecutar phases en paralelo con orchestrators separados.

13. PARALELISMO INTERNO

Fresh Claude decide.

Reglas:

- no nested delegation;
- no conflicting writers;
- migrations locked;
- shared contracts locked;
- parallelism solo donde existe independencia real;
- no grandes waves;
- no ejecutar todos los 13 agentes;
- no iniciar trabajo grande cerca de usage exhaustion.

14. ESPECIALIDADES PROBABLES

Informativo, no Work Unit fijo.

Fase 1:

Web Architect
Database & Data
Auth & Authorization
Backend & API
External Integrations
SEO & Discovery
QA
AppSec
Integration & Evidence

Fase 2:

UX
UI
Frontend
Auth
Backend
QA
AppSec
Integration & Evidence

Fase 3:

Database
Backend
Auth/Authorization
UX
UI
Frontend
QA
AppSec
Integration & Evidence

Fase 4:

Database
Backend
External Integrations
UI
Frontend
SEO
QA
AppSec
Integration & Evidence

Fase 5:

Web Architect
External Integrations
QA
AppSec
SEO
Integration & Evidence
Human Simulation
plus owner specialists for remediation.

15. OWNER DECISIONS

OWN-01 — Vercel commercial usage

Bloquea cutover comercial.

No bloquea Preview ni preparación técnica.

OWN-02 — Domain renewal

Bloquea continuidad futura, no implementación inmediata.

OWN-03 — GitHub visibility

Bloquea publicación remota de baseline V1.

Debe resolverse al inicio de Fase 1.

OWN-04 — Confirmed Registration cancellation policy

Bloquea T41 cancellation.

Debe resolverse antes de Gate Fase 3.

OWN-05 — Terms/Privacy acceptance

Bloquea legal completion del participant journey.

Debe resolverse antes de Gate Fase 2.

OWN-06 — RPO/RTO

Bloquea Production Gate.

OWN-07 — Legal/WhatsApp/brand

Bloquea partes específicas de Production Release.

16. OPEN TECHNICAL DECISIONS

OPEN-01 — Worker scheduling mechanism

Roadmap preference:

Supabase pg_cron + pg_net.

Final implementation may vary only if worker contracts, frequency, security and cost constraints remain satisfied.

OPEN-02 — Preview backend

Must never be production.

Resolve in Fase 1.

OPEN-03 — PostgREST pre-request gateway

ADR deferred.

Re-evaluate only where needed; do not reopen without reason.

OPEN-04 — Email capacity

Resolve before real public opening.

OPEN-05 — Netlify retirement window

Resolve after production stability.

OPEN-06 — Gate 0 formal state

Can close after Master/Roadmap corrections and authority reconciliation in Fase 1.

17. FINANCIAL BOUNDARY

No phase authorizes monetary commitment.

Forbidden without explicit owner action:

card;
billing;
upgrade;
paid plan;
paid trial;
subscription;
credits;
add-on;
domain renewal payment.

If a provider requirement conflicts:

document;
continue independent work;
stop only affected operation.

18. NETLIFY POLICY

After Fase 1:

Netlify must not receive new product-specific architecture.

Permitted temporary roles:

legacy placeholder;
rollback.

Forbidden:

new Netlify-only worker;
new Netlify-only header dependency;
new Netlify-only feature;
new Netlify-specific storage design.

19. ROADMAP AUTHORITY

Hierarchy:

Project Master Spec / approved specifications / ADRs
>
Execution Roadmap
>
Phase Packet
>
Task Envelope
>
agent memory / conversation assumptions

Roadmap cannot override CLOSED Master rules.

Phase Packet cannot override Roadmap.

Task Envelope cannot override Phase Packet.

Agent cannot override Task Envelope.

20. DISCOVERIES DURING EXECUTION

Case A — local implementation detail

Specialist may resolve inside Work Unit when IMPLEMENTATION_FLEXIBLE.

Case B — durable technical decision

Create/update ADR.

Case C — product decision

OWNER_DECISION.

Case D — discovery affects future phases

After validation, update Roadmap.

Do not leave durable decisions only in chat.

21. DOCUMENTATION POLICY

Update only durable truth.

Do not write chronological agent diaries.

Do not paste full code.

Do not duplicate tests in prose.

Artifacts expected per phase:

Phase Packet
Task Envelopes
evidence
Phase Report
durable ADR/docs delta where needed
phase state

Owner normally reviews only Phase Report and product result.

22. PHASE COMPLETION CONTRACT

A phase is not complete because agents finished.

A phase is complete only if:

- observable outcome exists;
- required Work Units integrated;
- Technical Gate PASS;
- no unowned critical/high findings;
- evidence exists;
- docs durable reconciled;
- Integration & Evidence READY;
- Phase Report produced;
- Owner Human Gate APPROVE.

23. CAMPAIGN COMPLETION CONTRACT

RUNIIS V1 completes only if:

Phase 1 approved.
Phase 2 approved.
Phase 3 approved.
Phase 4 approved.
Phase 5 approved.

Additionally:

- production runs on Vercel;
- runiismty.com serves V1;
- Git durable;
- Master and Roadmap match reality;
- no material untracked WIP;
- CI green;
- production migrations verified;
- security PASS;
- QA PASS;
- accessibility PASS;
- performance PASS;
- SEO PASS;
- providers PASS;
- backup/restore PASS;
- Integration & Evidence READY;
- Human Simulation PASS;
- owner RELEASE_APPROVED.

24. ANTI-PATTERNS

Do not:

- create dozens of microphases;
- turn old T IDs into phases;
- design phases around agent names;
- send whole Master to each agent;
- let parent implement half the phase;
- let QA fix QA findings;
- let AppSec silently fix audit findings;
- use conversation as state;
- reopen CLOSED decisions;
- build new features for Netlify;
- postpone Vercel migration until final release;
- use Production DB from Preview;
- share Production secrets with Preview;
- keep Netlify scheduling after Fase 1;
- deploy incomplete work merely for appearance;
- accept PASS without evidence;
- delete Netlify before rollback window;
- bypass SalvaOps;
- create billing obligations;
- rebuild verified modules without evidence;
- run full suite after every small Work Unit;
- launch agents only because slots exist.

25. ROADMAP STATUS AT CREATION

Audit A0:

AUDIT_COMPLETE_WITH_OPEN_ITEMS

Phase 1:

READY_TO_PLAN

Conditions:

- OWN-03 before remote publication;
- OWN-01 only before commercial cutover, not before technical Vercel preparation.

Phase 2:

BLOCKED_BY_PHASE_1

Phase 3:

BLOCKED_BY_PHASE_2

Phase 4:

BLOCKED_BY_PHASE_3

Phase 5:

BLOCKED_BY_PHASE_4

26. NEXT ACTION AFTER OWNER APPROVAL

1. persist this Roadmap as canonical;
2. reconcile Master patches if not yet applied;
3. close OWN-03 before publishing baseline;
4. authorize SalvaOps Web Development for campaign or Phase 1;
5. start fresh Claude;
6. Claude verifies repo;
7. Claude reads Master, Roadmap, Audit baseline and Phase 1;
8. Claude generates Phase Packet JIT;
9. Claude generates Work Unit DAG;
10. Claude creates Task Envelopes;
11. specialists execute;
12. orchestrator integrates;
13. Technical Phase Gate;
14. Phase Report;
15. Owner Human Gate;
16. persist result;
17. terminate orchestrator;
18. fresh orchestrator for Fase 2.

27. FINAL PRINCIPLE

RUNIIS no debe terminarse sobre una plataforma temporal para después realizar una migración masiva.

La migración estructural se adelanta.

Fase 1 convierte Vercel en la realidad de plataforma.

Fases 2, 3 y 4 construyen el producto restante directamente contra esa realidad.

Fase 5 no vuelve a migrar arquitectura.

Fase 5 únicamente endurece, verifica y libera el sistema completo.

El resultado buscado es eliminar trabajo duplicado, reducir drift de ambientes, detectar incompatibilidades de proveedor temprano y asegurar que cada feature nueva nazca en la plataforma donde RUNIIS realmente operará.
