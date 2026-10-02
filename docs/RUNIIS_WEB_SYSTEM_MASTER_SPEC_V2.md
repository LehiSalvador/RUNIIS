RUNIIS WEB — SYSTEM MASTER SPECIFICATION V2

Estado del documento: fuente de verdad funcional y técnica para RUNIIS WEB V1.
Objetivo de uso: entregar a Claude como especificación maestra para orquestación multiagente, implementación, revisión, pruebas y cierre del producto.
Zona horaria operativa principal: America/Monterrey.
Idioma principal del producto: español.
Versión funcional objetivo: RUNIIS WEB V1.
Regla documental: este archivo describe el sistema vigente. No es un changelog. Las decisiones sustituidas se registran únicamente para impedir que vuelvan a introducirse accidentalmente.

0. PROPÓSITO

Este documento consolida el producto RUNIIS WEB V1 de extremo a extremo.

Debe permitir que un agente técnico competente pueda comprender y construir la aplicación sin consultar conversaciones históricas para completar reglas esenciales de producto.

El documento define visión, alcance, actores, journeys, modelo de dominio, estados, transiciones, modelo físico, seguridad, RLS, RBAC, API, jobs, outbox, comunicaciones, infraestructura, pruebas, gates, Definition of Done y dependencias externas.

Este documento no autoriza automáticamente despliegues productivos, envío real de correos, cambios de DNS, uso de credenciales, migraciones contra producción o publicación de textos legales provisionales. Esas operaciones requieren el entorno y autorización correspondientes.

1. JERARQUÍA DE AUTORIDAD

Cuando dos fuentes históricas parezcan contradecirse, aplicar esta precedencia:

1. decisión explícita más reciente del propietario del producto;
2. este System Master Specification V2;
3. documento especializado vigente cuya materia no haya sido sustituida;
4. arquitectura técnica anterior no sustituida;
5. documentación heredada;
6. research o propuestas no aprobadas.

Una omisión no se interpreta como sustitución.

Una decisión antigua no se restaura si una decisión posterior la reemplazó explícitamente.

Si una contradicción interna apareciera dentro de este mismo documento, el agente no debe inventar comportamiento. Debe detener únicamente el módulo afectado, registrar el conflicto, resolverlo contra los invariantes y la matriz de decisiones de este documento y, si continúa siendo una decisión material de producto, escalarla al propietario.

2. FUENTES CONSOLIDADAS

S01: RUNIIS_WEB_DISCOVERY_PUBLICO_UX_SEO_EVENTOS_V1.
S02: RUNIIS_WEB_DEFINICION_ESTRATEGICA_PRODUCTO_Y_ALCANCE_V1.
S03: RUNIIS_WEB_DOMINIO_EVENTO_RUTAS_MAPAS_CONTRATO_V1.
S04: RUNIIS_WEB_INSCRIPCION_IDENTIDAD_CHECKOUT_PAGOS_ARQUITECTURA_FUNCIONAL_V1.
S05: REGLAS_MAESTRAS_UNIFICADAS_PROYECTOS_IA_SALVAOPS_V2.
S06: RUNIIS_WEB_COMUNICACIONES_EMAIL_RESEND_PASES_QR_CHECKIN_V1.
S07: RUNIIS_WEB_OPERACION_ADMINISTRATIVA_TASK_CENTER_CIERRE_ASISTENCIA_KILOMETROS_V1.
S08: RUNIIS_WEB_COMUNIDAD_COMPETITIVA_PERFILES_KILOMETROS_RANKINGS_LOGROS_V1.
S09: RUNIIS_WEB_FOUNDATIONS_UX_SYSTEM_VISUAL_MOTION_RESPONSIVE_V1.
S10: RUNIIS_WEB_ARQUITECTURA_TECNICA_INTEGRAL_AUDITORIA_INFRA_SEGURIDAD_DATOS_V1.
A01: RUNIIS_WEB_AUDITORIA_MASTER_SPEC_V1.

Decisiones posteriores integradas:

- pagos integrados desplazados a V2;
- Stripe como candidato principal V2 y Mercado Pago como alternativa;
- V1 usa pago externo coordinado por WhatsApp;
- WhatsApp API fuera de V1;
- hold absoluto de 24 horas;
- confirmación/cancelación administrativa;
- eventos gratuitos con confirmación directa;
- Friends V1;
- GuestParticipant V1;
- Guest archivado después de 30 días sin borrar historial;
- Guest sin ranking, kilómetros o logros;
- perfiles V1 sin selector público/privado;
- moderación humana de avatar;
- suspensión de avatar durante tres meses por infracción;
- bloqueo por identidad;
- ban permanente revocable por ADMIN;
- Google + Email OTP;
- Apple Sign-In fuera;
- infraestructura sin suscripción obligatoria como condición del núcleo V1;
- Claude actuará como orquestador de agentes.

3. DECISIONES SUSTITUIDAS QUE NO DEBEN VOLVER A V1

SUP-001. Payment/PaymentAttempt/Stripe integrado como flujo V1. Sustituido por pago externo por WhatsApp y confirmación humana.
SUP-002. Hold de 10 minutos basado en inactividad. Sustituido por hold absoluto de hasta 24 horas.
SUP-003. SPEI, OXXO, MSI y métodos asíncronos V1. Fuera.
SUP-004. WhatsApp Business API/Twilio V1. Fuera. Vigente: enlace wa.me.
SUP-005. PRIVATE/PUBLIC editable por usuario V1. Sustituido. No existe selector privado.
SUP-006. UNCLAIMED profile persistente como sustituto de Guest. Sustituido por GuestParticipant sin cuenta, comunidad ni créditos.
SUP-007. Moderación automática obligatoria con Rekognition. Sustituida por revisión humana.
SUP-008. Apple Sign-In V1. Fuera.
SUP-009. Supabase heredado como base a migrar. Fuera. El proyecto actual se considera nuevo/limpio.
SUP-010. Netlify como hosting productivo final. Sustituido. Hosting objetivo CLOSED: Vercel (decisión del propietario, 2026-10-01); Netlify queda solo como legado y rollback hasta un cutover validado (ADR-002). El plan de hosting debe ser compatible con los términos vigentes del proveedor para la operación real de RUNIIS (ver §11 y OWN-01). Asumir un plan de hosting sin verificar esa compatibilidad tampoco es vigente.

4. DEFINICIÓN DEL PRODUCTO

RUNIIS es una plataforma web para publicar, administrar y operar eventos deportivos creados por el propio equipo RUNIIS.

RUNIIS no es marketplace de eventos externos, SaaS multi-organizador, white-label, sistema de franquicias, red social general ni plataforma financiera V1.

El equipo RUNIIS es pequeño. Los términos staff, administrador y organizador se refieren al mismo equipo operativo, con permisos internos diferentes.

Superficies principales:

- superficie pública;
- cuenta del participante;
- comunidad;
- superficie administrativa;
- Race Day/scanner.

5. OBJETIVO Y NORTH STAR

Objetivo: incrementar participación real en eventos RUNIIS y disminuir fricción operativa.

North Star: cantidad de Registration CONFIRMED.

La métrica cuenta personas/lugares individuales. Una RegistrationRequest con cuatro participantes confirmados incrementa la North Star en cuatro. Un evento gratuito también cuenta.

No cuentan clicks en Inscribirme, WhatsApp abierto, solicitudes pendientes, transferencias no confirmadas, scans ni emails enviados.

6. ALCANCE V1

V1 incluye Home, biblioteca de eventos, búsqueda, filtros, cards, páginas de Edition, SEO, Open Graph, sitemap, búsqueda de personas, cuenta, Google, Email OTP, onboarding, RunnerProfile, Friends, GuestParticipant, menores y guardianes, Event, Edition, Modality, Category, agenda, lugares, precio, capacidad global, capacidad por modalidad, rutas, editor de rutas, GPX, GeoJSON, POIs, contenido editorial, FREE registration, EXTERNAL_WHATSAPP registration, hold 24h, confirmación administrativa, Registration, ParticipantPass, QR, emails, favoritos, recordatorios, marketing consentido, campañas, kits, inventario básico, entrega, scanner, check-in, asistencia final, descalificación/elegibilidad, Task Center, cierre, DistanceCredit, ranking semanal, ranking mensual, historical live, historical monthly cut, Top 3, MONTHLY_PODIUM, HISTORICAL_PODIUM_CUT, avatar, moderación, sanciones, ban, auditoría, RLS, workers, analytics, observabilidad y pruebas.

7. V2 / PARKING LOT

Estas ideas se conservan únicamente a alto nivel. No crear tablas, UI, endpoints o complejidad preventiva específica salvo que una abstracción V1 razonable la facilite incidentalmente.

- Stripe integrado;
- Mercado Pago integrado;
- pago dentro de RUNIIS;
- Payment;
- PaymentAttempt;
- webhooks financieros;
- refunds automáticos;
- Stripe Connect;
- split payments;
- comisión RUNIIS;
- SPEI;
- OXXO;
- MSI;
- WhatsApp API;
- SMS;
- push;
- claim histórico de Guest;
- perfiles privados;
- cambio self-service de modalidad;
- timing/chip;
- tiempos oficiales;
- posiciones;
- resultados públicos;
- ranking por categoría;
- certificados;
- fotos/tagging;
- reconocimiento facial;
- Strava/Garmin;
- GPS personal como autoridad;
- live timing;
- offline-first robusto;
- WMS avanzado;
- posts;
- likes;
- comentarios;
- mensajes;
- followers;
- feed.

8. GLOSARIO CANÓNICO

Event: identidad durable de un concepto de evento.
Edition: ocurrencia concreta de un Event.
Modality: opción concreta de participación.
Category: clasificación de elegibilidad o agrupación; no es sinónimo de distancia.
RunnerProfile: persona canónica con cuenta RUNIIS.
CommunityProfile: proyección pública de RunnerProfile.
Friendship: relación bilateral aceptada.
GuestParticipant: participante sin cuenta, propiedad operativa de un buyer.
GuardianAssignment: relación de responsabilidad sobre menor.
RegistrationRequest: solicitud que agrupa participantes.
RegistrationRequestParticipant: cada participante incluido en una solicitud.
RegistrationHold: reserva temporal de capacidad.
RegistrationConfirmation: confirmación RUNIIS de la solicitud.
Registration: lugar individual confirmado.
ParticipantPass: pase lógico estable de una Registration.
ParticipantPassCredential: credencial QR versionada de un ParticipantPass.
ParticipantPassScan: intento de uso de una credencial.
AttendanceCheckin: evidencia de presencia operativa.
AttendanceResolution: resolución final de presencia.
SportingEligibilityResolution: resolución de elegibilidad deportiva/crediticia.
AttendanceFinalization: cierre versionado del universo de asistencia.
AdministrativeClosure: cierre administrativo versionado.
DistanceCredit: hecho durable de distancia acreditada.
RankingPeriod: periodo competitivo.
RankingProjection: vista dinámica reconstruible.
RankingSnapshot: resultado oficial versionado de un periodo/corte.
AchievementGrant: reconocimiento histórico.
AdminTask: proyección operativa de una condición que requiere intervención.
AuditLog: evidencia append-only.

9. ACTORES

ANONYMOUS: visitante sin sesión.
AUTHENTICATED_INCOMPLETE: usuario autenticado sin perfil listo.
RUNNER: RunnerProfile READY y ACTIVE.
MINOR_RUNNER: RunnerProfile de 15–17 años.
BUYER: Runner que inicia una RegistrationRequest.
FRIEND: Runner incluido por Friendship ACCEPTED.
GUEST: GuestParticipant.
GUARDIAN: RunnerProfile adulto responsable de un menor.
STAFF_ADMIN: ADMIN.
STAFF_OPERATOR: OPERATOR.
STAFF_CHECKIN: CHECKIN.
STAFF_MODERATOR: MODERATOR.
SYSTEM: workers, backend seguro y procesos internos.

10. ARQUITECTURA

Patrón: modular monolith.

Tecnología:

- Next.js App Router;
- React;
- TypeScript;
- PostgreSQL/Supabase;
- Supabase Auth;
- PostGIS;
- Vercel como hosting objetivo (Netlify: legado y rollback hasta cutover validado; ADR-002);
- Cloudinary como proveedor inicial de media;
- Brevo como transporte de email inicial;
- MapLibre GL JS;
- OpenFreeMap como proveedor inicial de tiles;
- PostHog opcional para analytics;
- Sentry opcional para errors;
- GitHub;
- GitHub Actions.

Los dominios dependen de interfaces propias, no de SDKs de proveedor como autoridad de negocio.

Interfaces conceptuales: EmailProvider, ObjectStorage, MapTileProvider, AnalyticsProvider, ErrorMonitoringProvider y AuthProvider.

11. PRINCIPIOS DE COSTO

El núcleo V1 no debe requerir una suscripción mensual obligatoria para iniciar operación.

Se permiten free tiers y servicios que eventualmente tengan plan de pago siempre que V1 funcione sin suscripción obligatoria, los límites estén documentados, el consumo sea observable, exista gate de capacidad antes de producción y el dominio no quede acoplado irreversiblemente al proveedor.

Stripe/Mercado Pago no aplican a V1.

Condición de hosting: el plan de hosting debe ser compatible con los términos de uso vigentes del proveedor para la operación real de RUNIIS; el gate de producción lo verifica en la fecha de despliegue (§192). Posición registrada del propietario (OWN-01, 2026-10-01): V1 no procesa ningún pago en la plataforma; la inscripción de pago es solo una cotización por WhatsApp con confirmación humana y el pago integrado queda para V2. Riesgo residual declarado: las fair-use guidelines de Vercel para el plan Hobby mencionan "requesting or processing payment from visitors". Este documento no interpreta los términos del proveedor; la condición se vuelve a confirmar antes de la apertura pública de ediciones de pago EXTERNAL_WHATSAPP (PEND-HOSTING-001).

12. SCHEMAS POSTGRESQL

auth: Supabase Auth.
app: dominio RUNIIS.
private: helpers y datos internos.
audit: auditoría.
infra: outbox, idempotencia, workers y eventos técnicos.

No utilizar public como cajón general. private, audit e infra no se exponen a Data API pública.

13. CONVENCIONES DE DATOS

PK: uuid default gen_random_uuid().
Timestamp: timestamptz.
Fecha local: date.
Hora local: time cuando sea necesaria antes de resolver timestamp.
Dinero: bigint en minor units.
Distancia: integer en metros.
Teléfono: E.164.
Estados: text + CHECK salvo motivo técnico fuerte.

No usar float para dinero. No usar email como PK. No almacenar passwords. No almacenar OAuth access tokens de usuario. No borrar evidencia histórica por conveniencia.

14. EXTENSIONES

Requeridas: pgcrypto, pg_trgm, unaccent y postgis.
Requeridas para el scheduler de workers (ADR-002): pg_cron (workers DB-only y disparadores), pg_net (POST HTTP a los workers de la aplicación) y supabase_vault (URL base y secreto del disparador por entorno).
Opcional si se utiliza constraint temporal avanzado: btree_gist.

15. AUTH Y RUNNER PROFILE LIFECYCLE

Supabase Auth es autoridad de sesión. RunnerProfile es autoridad deportiva/personal.

Un AuthUser puede existir antes de que RunnerProfile esté completo.

Estados de onboarding:
PROFILE_INCOMPLETE
READY

Estados de cuenta:
ACTIVE
IDENTITY_LOCKED
BANNED
DEACTIVATED

Modelo recomendado:

app.runner_profile
runner_profile_id uuid PK
auth_user_id uuid UNIQUE NOT NULL FK auth.users(id) ON DELETE RESTRICT
profile_readiness text NOT NULL CHECK IN ('PROFILE_INCOMPLETE','READY')
account_state text NOT NULL CHECK IN ('ACTIVE','IDENTITY_LOCKED','BANNED','DEACTIVATED')
full_name text NULL
search_name text NULL
date_of_birth date NULL
sex_code text NULL
phone_e164 text NULL
emergency_contact_name text NULL
emergency_contact_phone_e164 text NULL
emergency_contact_relationship text NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
ready_at timestamptz NULL

Reglas:

- no inventar valores placeholder;
- campos universales pueden ser NULL durante onboarding;
- READY exige todos los datos universales obligatorios;
- solamente READY + ACTIVE puede inscribirse;
- solamente READY puede ser publicable;
- full_name no es editable libremente por usuario;
- search_name se deriva;
- display_name público se sincroniza desde nombre real salvo regla administrativa.

16. ONBOARDING

Después de Google/OTP:

1. resolver AuthUser;
2. buscar RunnerProfile por auth_user_id;
3. si no existe, crear PROFILE_INCOMPLETE;
4. mostrar onboarding;
5. recopilar nombre completo, fecha de nacimiento, sexo, teléfono, contacto de emergencia y relación;
6. validar;
7. calcular minor status;
8. crear/actualizar CommunityProfile según política;
9. marcar READY;
10. emitir ProfileReady.

El onboarding es reanudable. No crear segundo RunnerProfile si el usuario abandona y vuelve.

17. GOOGLE Y EMAIL OTP

V1 ofrece Google y Email OTP. Apple, SMS y password tradicional como requisito principal están fuera.

Link de mecanismos:

- ejecutar desde sesión autenticada o flujo seguro soportado por Auth;
- no vincular por nombre;
- no vincular por teléfono;
- no vincular solo por DOB;
- no vincular por similitud.

Colisión: si dos AuthUser legítimos aparentan representar a la misma persona, no merge automático.

Recuperación: utilizar mecanismos verificados de Auth. Soporte manual no debe conceder cuenta basándose solamente en datos personales fáciles de conocer.

18. COMMUNITY PROFILE

app.community_profile
runner_profile_id uuid PK FK app.runner_profile ON DELETE RESTRICT
public_profile_id uuid UNIQUE NOT NULL
display_name text NOT NULL
avatar_asset_id uuid NULL
competition_status text NOT NULL
is_visible boolean NOT NULL DEFAULT true
is_searchable boolean NOT NULL DEFAULT true
verified_distance_projection_m bigint NOT NULL DEFAULT 0
verified_participation_count integer NOT NULL DEFAULT 0
updated_at timestamptz NOT NULL

competition_status:
ELIGIBLE
MINOR_NONCOMPETITIVE
SUSPENDED
INELIGIBLE

No existe selector PRIVATE/PUBLIC.

Nunca público: email, phone, DOB, edad exacta, contacto emergencia, guardian, sanciones, documentos y auth ids.

19. MENORES

V1 admite edades 15–17. Menores de 15 están fuera.

Reglas:

- menor debe tener RunnerProfile READY o GuestParticipant válido;
- requiere guardian adulto con RunnerProfile READY;
- guardian debe estar ACTIVE;
- guardian debe ser responsable válido conforme a términos;
- participación requiere verificación presencial;
- la verificación no es opcional por evento;
- menor puede tener perfil básico público según la decisión vigente;
- PII nunca pública;
- menor queda fuera de rankings competitivos públicos;
- menor no recibe achievement competitivo público.

DistanceCredit puede existir para historial personal. Elegibilidad competitiva se calcula al sport_date. Créditos obtenidos siendo menor no se incorporan retroactivamente a rankings competitivos cuando cumple 18. Al cumplir 18, nuevos créditos elegibles pueden participar. No reabrir rankings cerrados por cumpleaños.

20. GUARDIAN ASSIGNMENT

app.guardian_assignment
guardian_assignment_id uuid PK
minor_runner_profile_id uuid NULL FK app.runner_profile ON DELETE RESTRICT
minor_guest_participant_id uuid NULL FK app.guest_participant ON DELETE RESTRICT
guardian_profile_id uuid NOT NULL FK app.runner_profile ON DELETE RESTRICT
relationship_type text NOT NULL
status text NOT NULL
created_at timestamptz NOT NULL
activated_at timestamptz NULL
revoked_at timestamptz NULL

CHECK exactamente uno de minor_runner_profile_id/minor_guest_participant_id.
CHECK guardian_profile_id no puede ser el mismo RunnerProfile menor.

status: PENDING, ACTIVE, REVOKED.

21. GUARDIAN EVENT VERIFICATION

app.guardian_event_verification
guardian_event_verification_id uuid PK
registration_id uuid UNIQUE NOT NULL FK app.registration ON DELETE RESTRICT
guardian_assignment_id uuid NOT NULL FK app.guardian_assignment ON DELETE RESTRICT
status text NOT NULL
verification_method text NULL
verified_by_staff_id uuid NULL FK app.staff_member ON DELETE RESTRICT
verified_at timestamptz NULL
notes text NULL
created_at timestamptz NOT NULL

status: PENDING, VERIFIED, REJECTED.

Menor sin VERIFIED no puede completar EVENT_CHECKIN.

22. FRIENDSHIP

app.friendship
friendship_id uuid PK
requester_profile_id uuid NOT NULL FK app.runner_profile ON DELETE RESTRICT
addressee_profile_id uuid NOT NULL FK app.runner_profile ON DELETE RESTRICT
status text NOT NULL
requested_at timestamptz NOT NULL
responded_at timestamptz NULL
removed_at timestamptz NULL

status: PENDING, ACCEPTED, REJECTED, REMOVED.

CHECK requester != addressee.

CreateFriendship siempre crea PENDING. AcceptFriendship solamente puede ejecutarlo addressee. RejectFriendship solamente addressee. RemoveFriendship cualquiera de las partes.

La unicidad se aplica sobre el par no ordenado mientras la relación sea relevante.

23. PEOPLE SEARCH

Ruta funcional: Buscar -> Eventos por defecto -> Personas.

People search requiere sesión.

Campos buscables: display_name/search_name.

Normalización: lowercase, unaccent, espacios colapsados y trim.

Respuesta: public_profile_id, display_name, avatar aprobado, kilómetros públicos permitidos, logros públicos permitidos y friendship_state respecto al usuario actual.

No devolver DOB, email, phone, emergency, guardian ni auth ids.

Máximo inicial: 20 resultados por página. Noindex.

24. GUEST PARTICIPANT

app.guest_participant
guest_participant_id uuid PK
owner_profile_id uuid NOT NULL FK app.runner_profile ON DELETE RESTRICT
full_name text NOT NULL
date_of_birth date NOT NULL
sex_code text NOT NULL
phone_e164 text NOT NULL
emergency_contact_name text NOT NULL
emergency_contact_phone_e164 text NOT NULL
emergency_contact_relationship text NOT NULL
status text NOT NULL
last_event_end_at timestamptz NULL
archive_after timestamptz NULL
archived_at timestamptz NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL

status: ACTIVE, ARCHIVED.

Guest no tiene Auth, CommunityProfile, Friends, ranking, achievements ni DistanceCredit. El QR se entrega al buyer.

Guest menor 15–17 solamente con GuardianAssignment válido. Guest menor de 15 se rechaza.

25. ARCHIVO DE GUEST

archive_after se recalcula usando la última Edition relacionada terminada/cancelada que deba conservar contexto.

Si Guest tiene Registration futura activa, no archivar.

Si no tiene participación futura, archive_after = 30 días después del fin efectivo de su última Edition relacionada.

ARCHIVED no significa borrado. No aparece como opción reutilizable normal, pero se conserva para auditoría y operación. La retención definitiva es dependencia legal.

26. EVENT TYPE

app.event_type
event_type_id uuid PK
key text UNIQUE NOT NULL
name text NOT NULL
default_generates_distance_credit boolean NOT NULL
active boolean NOT NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL

Seeds: ROAD_RACE, TRAIL, HIKE, WALK, OTHER.

ROAD_RACE true. TRAIL true. HIKE true. WALK configurable. OTHER configurable.

27. EVENT

app.event
event_id uuid PK
event_type_id uuid NOT NULL FK app.event_type ON DELETE RESTRICT
name text NOT NULL
canonical_key text UNIQUE NOT NULL
status text NOT NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL

status: ACTIVE, ARCHIVED.

Event no contiene fecha anual como identidad.

28. EDITION

app.edition
edition_id uuid PK
event_id uuid NOT NULL FK app.event ON DELETE RESTRICT
slug text UNIQUE NOT NULL
name text NOT NULL
publication_state text NOT NULL
registration_state text NOT NULL
execution_state text NOT NULL
closure_state text NOT NULL
registration_mode text NOT NULL
timezone text NOT NULL
registration_open_at timestamptz NULL
registration_close_at timestamptz NOT NULL
global_capacity integer NULL CHECK(global_capacity IS NULL OR global_capacity >= 0)
city text NOT NULL
state_region text NOT NULL
country_code char(2) NOT NULL
primary_location_id uuid NULL
whatsapp_phone_e164 text NULL
is_benefit_event boolean NOT NULL DEFAULT false
published_at timestamptz NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL

publication_state: DRAFT, PUBLISHED, HIDDEN.
registration_state: NOT_OPEN, OPEN, PAUSED, CLOSED.
execution_state: SCHEDULED, POSTPONED, IN_PROGRESS, FINISHED, CANCELED.
closure_state: OPEN, PENDING, CLOSED.
registration_mode: FREE, EXTERNAL_WHATSAPP.

29. EDITION SCHEDULE REVISION

La fecha/hora no debe modelarse como un único start_at obligatorio que fuerce datos falsos.

app.edition_schedule_revision
edition_schedule_revision_id uuid PK
edition_id uuid NOT NULL FK app.edition ON DELETE RESTRICT
revision integer NOT NULL
schedule_state text NOT NULL
local_date date NULL
local_start_time time NULL
local_end_time time NULL
timezone text NOT NULL
effective_start_at timestamptz NULL
effective_end_at timestamptz NULL
reason text NULL
created_by_staff_id uuid NOT NULL FK app.staff_member ON DELETE RESTRICT
created_at timestamptz NOT NULL
superseded_at timestamptz NULL

UNIQUE(edition_id,revision).

schedule_state: DATE_CONFIRMED_TIME_PENDING, DATE_TIME_CONFIRMED, POSTPONED_NO_NEW_DATE.

Una única revisión activa por Edition.

DRAFT puede tener fecha incompleta. PUBLISHED requiere al menos fecha conocida salvo estado POSTPONED posterior. Hora puede estar pendiente. Nunca inventar 00:00 como hora pública. Reprogramar crea nueva revisión. Edition conserva identidad y slug.

30. PUBLICATION READINESS

Publicar exige Event válido, Edition válida, event_type, slug, timezone, ciudad, fecha conocida, una Modality, imagen principal o fallback, descripción mínima y estados coherentes.

No exige obligatoriamente ruta terminada si el evento no la requiere, venue definitivo ni hora definitiva.

31. REGISTRATION READINESS

Abrir inscripción exige Edition PUBLISHED, execution_state SCHEDULED, schedule con fecha válida, registration_open_at satisfecho, registration_close_at futuro, al menos una Modality ACTIVE, capacidad válida, precio válido o FREE explícito, reglas de elegibilidad, formulario requerido versionado, WhatsApp efectivo si EXTERNAL_WHATSAPP y documentos legales necesarios publicados.

32. EDITION TRANSITIONS

DRAFT -> PUBLISHED: PublishEdition.
PUBLISHED -> HIDDEN: solo ADMIN, excepcional, auditado.
NOT_OPEN -> OPEN: OpenRegistration.
OPEN -> PAUSED: PauseRegistration.
PAUSED -> OPEN: ResumeRegistration.
OPEN/PAUSED/NOT_OPEN -> CLOSED: CloseRegistration.
SCHEDULED -> POSTPONED: PostponeEdition.
POSTPONED -> SCHEDULED: RescheduleEdition con nueva revisión.
SCHEDULED -> IN_PROGRESS: StartEdition manual o regla controlada.
IN_PROGRESS/SCHEDULED -> FINISHED: FinishEdition.
FINISHED -> closure_state PENDING.
SCHEDULED/POSTPONED -> CANCELED: CancelEdition.
closure OPEN/PENDING -> CLOSED: CloseEdition.
CLOSED -> PENDING: ReopenEdition mediante command explícito.

No usar PATCH genérico para saltar estados.

33. CANCELACIÓN Y REPROGRAMACIÓN

CancelEdition cambia execution_state a CANCELED, registration_state a CLOSED, cancela/libera holds pendientes, bloquea nuevas solicitudes, mantiene página, envía comunicación a confirmados, invalida caches y conserva historial. No procesa refund.

PostponeEdition conserva URL, crea schedule revision POSTPONED_NO_NEW_DATE, pausa/cierra nuevas inscripciones según command, invalida recordatorios obsoletos y comunica cuando corresponda.

RescheduleEdition crea schedule revision, conserva Registration, reprograma reminders, actualiza SEO/JSON-LD y comunica cambio material.

34. MODALITY

app.modality
modality_id uuid PK
edition_id uuid NOT NULL FK app.edition ON DELETE RESTRICT
key text NOT NULL
name text NOT NULL
official_distance_m integer NULL
generates_distance_credit boolean NOT NULL
local_start_time time NULL
status text NOT NULL
sort_order integer NOT NULL
eligibility_rule_version integer NOT NULL DEFAULT 1
eligibility_rules jsonb NOT NULL DEFAULT '{}'
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL

UNIQUE(edition_id,key).
status: ACTIVE, CLOSED, CANCELED.

Si generates_distance_credit=true, official_distance_m debe ser >0 antes de abrir inscripción.

35. CAPACITY

Capacidad global: Edition.global_capacity, opcional.

Capacidad por modalidad:

app.modality_capacity
modality_id uuid PK FK app.modality ON DELETE RESTRICT
effective_capacity integer NOT NULL CHECK(effective_capacity >=0)
updated_at timestamptz NOT NULL
updated_by_staff_id uuid NULL FK app.staff_member ON DELETE RESTRICT

Disponibilidad por modalidad = effective_capacity - Registration activas que ocupan cupo - Holds ACTIVE efectivos.

Disponibilidad global = edition.global_capacity - Registration activas en todas sus modalidades - Holds ACTIVE efectivos en todas sus modalidades.

Si global_capacity es NULL no existe límite global adicional.

No guardar available_slots como autoridad.

36. AVAILABILITY STATES

AVAILABLE: hay cupo utilizable.
LOW: hay cupo por debajo de umbral cuantitativo configurado.
TEMPORARILY_UNAVAILABLE: cupo libre inmediato 0 debido total/parcialmente a holds, pero puede liberarse.
SOLD_OUT: capacidad definitiva consumida por Registration confirmadas o regla irreversible.
CLOSED no es availability_state; es registration_state.

La UI no debe decir Agotado si el bloqueo proviene exclusivamente de holds.

37. CONCURRENCIA DE CAPACIDAD

Orden de locks obligatorio:

1. Edition/capacidad global;
2. ModalityCapacity rows ordenadas por modality_id;
3. request/registration objects cuando corresponda.

Create request y confirmación deben volver a calcular dentro de transacción.

Caso global 1000, 5K 600, 10K 600: nunca permitir ocupación superior a 1000.

38. PRICE OFFER

app.price_offer
price_offer_id uuid PK
modality_id uuid NOT NULL FK app.modality ON DELETE RESTRICT
name text NOT NULL
amount_minor bigint NOT NULL CHECK(amount_minor >=0)
currency char(3) NOT NULL
starts_at timestamptz NULL
ends_at timestamptz NULL
status text NOT NULL
priority integer NOT NULL DEFAULT 0
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL

status: ACTIVE, INACTIVE, EXPIRED.

Selección determinista en timestamp T:

1. status ACTIVE;
2. starts_at NULL o <= T;
3. ends_at NULL o > T;
4. priority DESC;
5. starts_at DESC NULLS LAST;
6. created_at DESC;
7. price_offer_id ASC como desempate técnico.

Administración debe advertir solapamientos. FREE no se infiere de ausencia de PriceOffer. registration_mode FREE usa amount snapshot 0.

39. CATEGORY

app.category
category_id uuid PK
edition_id uuid NOT NULL FK app.edition ON DELETE RESTRICT
name text NOT NULL
key text NOT NULL
eligibility_rule jsonb NOT NULL DEFAULT '{}'
assignment_mode text NOT NULL
active boolean NOT NULL DEFAULT true
sort_order integer NOT NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL

UNIQUE(edition_id,key).
assignment_mode: USER_SELECTS, SYSTEM_DERIVES.

app.modality_category
modality_id uuid FK app.modality ON DELETE RESTRICT
category_id uuid FK app.category ON DELETE RESTRICT
PRIMARY KEY(modality_id,category_id)

40. REGISTRATION CATEGORY ASSIGNMENT

app.registration_category_assignment
registration_category_assignment_id uuid PK
registration_id uuid UNIQUE NOT NULL FK app.registration ON DELETE RESTRICT
category_id uuid NOT NULL FK app.category ON DELETE RESTRICT
assignment_source text NOT NULL
eligibility_snapshot jsonb NOT NULL
assigned_at timestamptz NOT NULL

assignment_source: USER_SELECTION, DERIVED.

Cambio material de fecha/modalidad puede requerir recalcular categoría mediante command auditado.

41. FORMULARIOS CONFIGURABLES

Datos universales viven en RunnerProfile. Datos específicos de evento viven en definiciones versionadas y respuestas.

app.registration_form
registration_form_id uuid PK
edition_id uuid NOT NULL FK app.edition ON DELETE RESTRICT
modality_id uuid NULL FK app.modality ON DELETE RESTRICT
version integer NOT NULL
status text NOT NULL
created_at timestamptz NOT NULL
published_at timestamptz NULL

status: DRAFT, PUBLISHED, SUPERSEDED.

app.registration_form_field
registration_form_field_id uuid PK
registration_form_id uuid NOT NULL FK app.registration_form ON DELETE RESTRICT
field_key text NOT NULL
label text NOT NULL
field_type text NOT NULL
required boolean NOT NULL
validation_config jsonb NOT NULL DEFAULT '{}'
options_config jsonb NOT NULL DEFAULT '{}'
sensitivity text NOT NULL DEFAULT 'NORMAL'
sort_order integer NOT NULL

UNIQUE(registration_form_id,field_key).

field_type: TEXT, TEXTAREA, SELECT, MULTISELECT, BOOLEAN, DATE, NUMBER.

No almacenar lógica ejecutable arbitraria dentro de JSON. validation_config y options_config deben seguir schema versionado validado por backend.

42. REGISTRATION FIELD RESPONSE

app.registration_field_response
registration_field_response_id uuid PK
request_participant_id uuid NOT NULL FK app.registration_request_participant ON DELETE RESTRICT
registration_form_field_id uuid NOT NULL FK app.registration_form_field ON DELETE RESTRICT
value_json jsonb NOT NULL
field_snapshot jsonb NOT NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL

UNIQUE(request_participant_id,registration_form_field_id).

Las respuestas pertenecen al participante de solicitud. Al confirmar Registration se mantienen vinculadas al RequestParticipant inmutable. No se copian al RunnerProfile salvo que explícitamente sean datos universales actualizables mediante otro flujo.

43. LOCATIONS

app.edition_location
edition_location_id uuid PK
edition_id uuid NOT NULL FK app.edition ON DELETE RESTRICT
location_type text NOT NULL
name text NOT NULL
address_line text NULL
city text NULL
state_region text NULL
country_code char(2) NULL
geometry geography(Point,4326) NULL
is_primary boolean NOT NULL DEFAULT false
sort_order integer NOT NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL

location_type: DISCOVERY, VENUE, START, FINISH, MEETING_POINT, PARKING, KIT_PICKUP, OTHER.

La ubicación de discovery puede ser ciudad/municipio. Venue puede estar pendiente. No duplicar coordenadas divergentes en rich text.

44. AGENDA

app.edition_schedule_item
edition_schedule_item_id uuid PK
edition_id uuid NOT NULL FK app.edition ON DELETE RESTRICT
modality_id uuid NULL FK app.modality ON DELETE RESTRICT
title text NOT NULL
description text NULL
local_date date NOT NULL
local_start_time time NULL
local_end_time time NULL
location_id uuid NULL FK app.edition_location ON DELETE RESTRICT
sort_order integer NOT NULL
status text NOT NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL

status: ACTIVE, CANCELED.

Agenda estructurada es autoridad. Un bloque editorial puede presentarla, no redefinirla.

45. ROUTE

app.route
route_id uuid PK
edition_id uuid NOT NULL FK app.edition ON DELETE RESTRICT
name text NOT NULL
status text NOT NULL
active_revision_id uuid NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL

status: DRAFT, PUBLISHED, ARCHIVED.

Una Route puede asociarse a varias modalidades.

app.route_modality
route_id uuid FK app.route ON DELETE RESTRICT
modality_id uuid FK app.modality ON DELETE RESTRICT
PRIMARY KEY(route_id,modality_id)

La aplicación debe validar que Route y Modality pertenezcan a la misma Edition.

46. ROUTE REVISION

app.route_revision
route_revision_id uuid PK
route_id uuid NOT NULL FK app.route ON DELETE RESTRICT
revision integer NOT NULL
status text NOT NULL
geometry geometry(LineString,4326) NOT NULL
geojson_snapshot jsonb NOT NULL
computed_distance_m integer NULL
source text NOT NULL
source_filename text NULL
validation_result jsonb NOT NULL DEFAULT '{}'
created_by_staff_id uuid NOT NULL FK app.staff_member ON DELETE RESTRICT
created_at timestamptz NOT NULL
published_at timestamptz NULL
superseded_at timestamptz NULL

UNIQUE(route_id,revision).

status: DRAFT, PUBLISHED, SUPERSEDED.
source: MANUAL, GPX_IMPORT, DUPLICATED.

Geometría canónica: WGS84/EPSG:4326. GeoJSON usa orden [longitude, latitude].

47. ROUTE POI

app.route_poi
route_poi_id uuid PK
route_revision_id uuid NOT NULL FK app.route_revision ON DELETE RESTRICT
poi_type text NOT NULL
name text NOT NULL
geometry geography(Point,4326) NOT NULL
sort_order integer NOT NULL
metadata jsonb NOT NULL DEFAULT '{}'
created_at timestamptz NOT NULL

poi_type: START, FINISH, HYDRATION, MEDICAL, CHECKPOINT, RESTROOM, VIEWPOINT, OTHER.

48. EDITOR DE RUTA

Journey administrativo:

CreateRoute
-> seleccionar Edition
-> seleccionar una o más modalidades
-> elegir MANUAL, GPX IMPORT o DUPLICATE
-> editar
-> validar
-> preview
-> guardar DRAFT
-> publicar revisión explícitamente.

Herramientas mínimas:

- añadir vértice;
- mover vértice;
- insertar vértice;
- eliminar vértice;
- undo;
- redo;
- configurar salida;
- configurar meta;
- POIs;
- calcular distancia;
- warnings;
- errores;
- preview.

No exigir editor geométrico complejo en móvil. En móvil puede ser read-only o edición limitada.

49. GPX

Flujo:

1. recibir .gpx;
2. limitar tamaño;
3. parsear de forma segura;
4. detectar tracks/routes/waypoints;
5. rechazar archivo inválido;
6. normalizar;
7. convertir a GeoJSON WGS84;
8. simplificar para preview si necesita performance;
9. conservar geometría canónica adecuada;
10. calcular computed_distance_m;
11. importar POIs útiles;
12. mostrar preview;
13. permitir corrección;
14. guardar RouteRevision DRAFT;
15. publicar solo mediante command separado.

GPX nunca cambia official_distance automáticamente.

50. ROUTE VALIDATION

Errores bloqueantes:

- geometría ausente;
- coordenadas inválidas;
- LineString degenerado;
- datos fuera de rango;
- revision corrupta.

Warnings:

- salida/meta ausente;
- saltos improbables;
- computed_distance muy distinta de official_distance;
- demasiados puntos;
- self-intersection cuando sea relevante;
- POIs fuera de cercanía razonable.

Warning no necesariamente bloquea publish. Error sí.

51. EVENT CONTENT BLOCK

app.event_content_block
event_content_block_id uuid PK
edition_id uuid NOT NULL FK app.edition ON DELETE RESTRICT
modality_id uuid NULL FK app.modality ON DELETE RESTRICT
block_type text NOT NULL
position integer NOT NULL
status text NOT NULL
payload jsonb NOT NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL

block_type: RICH_TEXT, CALLOUT, IMAGE, GALLERY, FAQ, DOCUMENT_LINK, SPONSOR_GROUP, CUSTOM_SECTION.

No usar rich text como autoridad de fecha, precio, cupo, modalidad, agenda, ubicación, distancia o estado.

52. EVENT MEDIA ASSET

app.event_media_asset
event_media_asset_id uuid PK
edition_id uuid NOT NULL FK app.edition ON DELETE RESTRICT
media_type text NOT NULL
storage_object_key text NOT NULL
alt_text text NOT NULL
status text NOT NULL
sort_order integer NOT NULL
focal_point jsonb NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL

status: PENDING, PUBLISHED, ARCHIVED.

Los archivos viven en object storage; DB conserva metadata y autoridad de publicación.

53. DISCOVERY

Rutas públicas mínimas:

/
/eventos
/eventos/{slug}
/ranking
/personas/{publicProfileId}
/runiis
/contacto
/legal/terminos
/legal/privacidad

Home:

1. Hero;
2. próximas carreras;
3. acceso biblioteca;
4. comunidad/podio;
5. información RUNIIS;
6. novedades cuando correspondan;
7. contacto;
8. footer.

La Home prioriza eventos.

54. EVENT SEARCH

Búsqueda por nombre, ubicación y distancia normalizada cuando aplique.

Normalización: trim, lowercase, unaccent y whitespace collapse.

Filtros V1:

- fecha;
- tipo de evento;
- distancia;
- ubicación;
- precio;
- inscripciones abiertas.

Los filtros combinan AND entre dimensiones. Dentro de una dimensión multiselect puede utilizar OR.

Orden por defecto: fecha futura más cercana. Eventos pasados en sección separada.

55. URL STATE

Filtros y búsqueda viven en query params. Volver desde Event page debe poder recuperar estado anterior mediante URL.

URLs filtradas son compartibles, pero no páginas SEO automáticas. Canonical debe apuntar a la estrategia estable definida para biblioteca o páginas específicas.

56. EMPTY/ERROR STATES

Diferenciar:

- no hay próximos eventos;
- filtros sin resultados;
- búsqueda sin coincidencias;
- error cargando;
- temporalmente sin disponibilidad;
- agotado;
- inscripción cerrada;
- cancelado;
- aplazado.

No mostrar un error como empty state.

57. EVENT CARD

Debe mostrar imagen, nombre, fecha, ubicación, modalidad/distancia, precio, estado y CTA Ver carrera.

Si modalidades difieren, no mostrar un único dato engañoso.

58. EVENT PAGE

Nivel 1:

- nombre;
- estado;
- fecha/hora;
- ubicación;
- modalidades;
- distancia;
- precio;
- disponibilidad;
- CTA.

Nivel 2:

- logística;
- agenda;
- ruta;
- kit;
- categorías;
- puntos adicionales.

Nivel 3:

- FAQ;
- documentos;
- sponsors;
- contacto.

CTA:

OPEN + AVAILABLE/LOW -> Inscribirme.
OPEN + TEMPORARILY_UNAVAILABLE -> Temporalmente no disponible.
SOLD_OUT -> Agotado.
NOT_OPEN -> Recordarme.
CLOSED -> Inscripciones cerradas.
CANCELED -> Evento cancelado.
POSTPONED -> Evento aplazado.
FINISHED -> Evento realizado.

No urgencia falsa.

59. SEO

Por Edition publicada:

- title;
- description;
- canonical;
- Open Graph;
- social image;
- SportsEvent/Event JSON-LD;
- breadcrumbs;
- sitemap.

Cambio de slug conserva redirect permanente.

app.edition_slug_history
edition_slug_history_id uuid PK
edition_id uuid NOT NULL FK app.edition ON DELETE RESTRICT
old_slug text UNIQUE NOT NULL
new_slug text NOT NULL
changed_at timestamptz NOT NULL

60. CACHE

Contenido editorial y route publicada pueden cachearse con invalidación.

Availability es dinámica y utiliza TTL corto o lectura server-side fresca.

Ranking OPEN es dinámico. Snapshots CLOSED son cacheables por revision. Perfil público puede cachearse con invalidación. Respuestas autenticadas nunca se sirven desde cache compartido público.

Invalidadores principales:

EditionPublished
EditionRescheduled
EditionPostponed
EditionCanceled
EditionSlugChanged
PriceOfferChanged
CapacityChanged
RegistrationRequestCreated
RegistrationRequestExpired
RegistrationConfirmed
AvatarApproved
AvatarRemoved
AccountBanned
DistanceCreditChanged
RankingProjectionUpdated
RankingSnapshotCreated

Retiro de avatar/ban debe propagarse a superficies públicas.

61. REGISTRATION REQUEST

app.registration_request
registration_request_id uuid PK
public_reference text UNIQUE NOT NULL
buyer_profile_id uuid NOT NULL FK app.runner_profile ON DELETE RESTRICT
edition_id uuid NOT NULL FK app.edition ON DELETE RESTRICT
status text NOT NULL
registration_mode text NOT NULL
currency char(3) NOT NULL
total_snapshot_minor bigint NOT NULL CHECK(total_snapshot_minor>=0)
whatsapp_phone_snapshot text NULL
created_at timestamptz NOT NULL
expires_at timestamptz NULL
confirmed_at timestamptz NULL
canceled_at timestamptz NULL
canceled_by_profile_id uuid NULL FK app.runner_profile ON DELETE RESTRICT
canceled_by_staff_id uuid NULL FK app.staff_member ON DELETE RESTRICT
cancel_reason text NULL
revalidated_from_expired boolean NOT NULL DEFAULT false
updated_at timestamptz NOT NULL

status: PENDING_CONFIRMATION, CONFIRMED, CANCELED_BY_BUYER, CANCELED_BY_STAFF, EXPIRED.

No es Payment.

62. REQUEST PARTICIPANT

app.registration_request_participant
request_participant_id uuid PK
registration_request_id uuid NOT NULL FK app.registration_request ON DELETE RESTRICT
participant_kind text NOT NULL
runner_profile_id uuid NULL FK app.runner_profile ON DELETE RESTRICT
guest_participant_id uuid NULL FK app.guest_participant ON DELETE RESTRICT
modality_id uuid NOT NULL FK app.modality ON DELETE RESTRICT
category_id uuid NULL FK app.category ON DELETE RESTRICT
price_offer_id uuid NULL FK app.price_offer ON DELETE RESTRICT
price_snapshot_minor bigint NOT NULL CHECK(price_snapshot_minor>=0)
currency char(3) NOT NULL
eligibility_snapshot jsonb NOT NULL
created_at timestamptz NOT NULL

CHECK PROFILE => runner_profile_id non-null y guest null.
CHECK GUEST => guest non-null y runner null.

No repetir el mismo participante dentro de request.

63. HOLD

app.registration_hold
registration_hold_id uuid PK
registration_request_id uuid NOT NULL FK app.registration_request ON DELETE RESTRICT
modality_id uuid NOT NULL FK app.modality ON DELETE RESTRICT
quantity integer NOT NULL CHECK(quantity>0)
status text NOT NULL
expires_at timestamptz NOT NULL
created_at timestamptz NOT NULL
consumed_at timestamptz NULL
released_at timestamptz NULL

status: ACTIVE, CONSUMED, EXPIRED, RELEASED.

UNIQUE(registration_request_id,modality_id).

Hold efectivo: status ACTIVE AND expires_at > now(). Aunque el worker no haya actualizado status, expires_at gobierna disponibilidad.

64. REGLA 24 HORAS

Para EXTERNAL_WHATSAPP:
expires_at = min(created_at + 24h, edition.registration_close_at).

No extensión por actividad, abrir WhatsApp o refrescar.

Countdown deriva de server time/expires_at.

65. PRECONDICIONES CREATE REGISTRATION REQUEST

Buyer:

- auth válido;
- RunnerProfile READY;
- account_state ACTIVE.

Edition:

- PUBLISHED;
- registration_state OPEN;
- execution_state SCHEDULED;
- now >= registration_open_at si existe;
- now < registration_close_at;
- no CANCELED/POSTPONED.

Cada Modality:

- pertenece a Edition;
- ACTIVE;
- elegible;
- PriceOffer resoluble o FREE.

Cada PROFILE participante:

- READY;
- ACTIVE;
- no banned;
- no identity locked;
- buyer mismo o Friendship ACCEPTED;
- no Registration CONFIRMED en Edition;
- no participación simultánea incompatible.

Cada GUEST:

- owner=buyer;
- ACTIVE;
- edad permitida;
- guardian si menor.

Menor:
GuardianAssignment ACTIVE.

Datos:

- términos aplicables aceptados;
- form responses válidas;
- Category válida/derivable.

Capacidad:

- global;
- modalidad.

66. CONFLICTO DE PARTICIPANTE EN HOLDS

Un mismo RunnerProfile no puede estar simultáneamente reservado en múltiples solicitudes activas para la misma Edition.

La implementación debe materializar una claim transaccional o mecanismo equivalente que permita unicidad efectiva por Edition + participant mientras el hold sea válido.

Para PROFILE: edition_id + runner_profile_id único mientras hold efectivo.
Para GUEST: edition_id + guest_participant_id único mientras hold efectivo.

No confiar solo en consulta sin lock.

67. CREATE REQUEST TRANSACTION

BEGIN

- lock Edition/capacidad global;
- lock ModalityCapacity ordenado;
- validar precondiciones;
- calcular disponibilidad global;
- calcular disponibilidad modalidades;
- resolver PriceOffer;
- crear request;
- crear participants;
- validar/guardar form responses;
- crear participant claims;
- crear holds;
- registrar legal acceptance;
- outbox RegistrationRequestCreated;
- COMMIT.

Si falla un participante: ROLLBACK total.

68. WHATSAPP HANDOFF

Número efectivo: Edition.whatsapp_phone_e164 o PlatformSettings.default_whatsapp_phone_e164.

Generar wa.me.

Mensaje mínimo: Hola. Quiero completar mi inscripción a [Edition]. Referencia: [public_reference].

No incluir DOB, teléfonos de participantes, emergency, guardian, email ni datos sensibles en URL.

RUNIIS no lee la conversación.

69. USER PENDING EXPERIENCE

Mi cuenta muestra Edition, participantes, modalidad, total snapshot, estado, expires_at, countdown, Continuar por WhatsApp y Cancelar.

No afirmar “pagado” mientras staff no confirme.

70. ADMIN REQUEST QUEUE

Por Edition mostrar reference, buyer, participantes, modalidades, precio snapshot, created_at, expires_at, expiración efectiva, status, contacto buyer, confirm y cancel.

Solicitudes normales no generan AdminTask individual. Puede existir badge/count.

71. CONFIRMATION BEFORE EXPIRY

ConfirmRegistrationRequest exige request PENDING_CONFIRMATION, now < expires_at, staff autorizado, participantes aún elegibles, Edition/Modality válidas, claims vigentes y capacidad coherente.

Dentro de ventana válida se conserva price snapshot de request.

72. CONFIRMATION AFTER EXPIRY

El resultado no depende de si corrió el worker.

Si now >= expires_at, tratar request como expirado aunque status siga PENDING.

Command: RevalidateExpiredRegistrationRequestAndConfirm.

Revalidar:

- request no confirmado/cancelado;
- staff;
- Edition;
- participantes;
- duplicados;
- capacidad global;
- capacidad modalidad;
- PriceOffer vigente.

No contar hold viejo.

Si precio cambió: PRICE_CHANGED. Staff coordina externamente y actualiza snapshot mediante revalidación explícita antes de confirmar.

Si cupo no existe: CAPACITY_UNAVAILABLE.

Si todo válido: confirmar bajo locks, marcar revalidated_from_expired=true, audit.

73. CANCEL REQUEST

Buyer puede cancelar PENDING no confirmado. Staff puede cancelar PENDING o EXPIRED no confirmado.

Efectos: request canceled, holds RELEASED, claims liberados, outbox y audit si staff.

74. FREE REGISTRATION

registration_mode FREE.

Mismas validaciones de identidad, capacidad y elegibilidad.

Transacción única:

- validate;
- capacity locks;
- request;
- participants;
- responses;
- legal;
- RegistrationConfirmation FREE_AUTO;
- Registrations;
- category assignments;
- ParticipantPass;
- ParticipantPassCredential;
- outbox;
- COMMIT.

No WhatsApp. No hold 24h.

75. REGISTRATION CONFIRMATION

app.registration_confirmation
registration_confirmation_id uuid PK
registration_request_id uuid UNIQUE NOT NULL FK app.registration_request ON DELETE RESTRICT
confirmation_method text NOT NULL
confirmed_by_staff_id uuid NULL FK app.staff_member ON DELETE RESTRICT
confirmed_at timestamptz NOT NULL
notes text NULL

confirmation_method: EXTERNAL_WHATSAPP, FREE_AUTO.

No Payment.

76. REGISTRATION

app.registration
registration_id uuid PK
registration_request_id uuid NOT NULL FK app.registration_request ON DELETE RESTRICT
request_participant_id uuid UNIQUE NOT NULL FK app.registration_request_participant ON DELETE RESTRICT
edition_id uuid NOT NULL FK app.edition ON DELETE RESTRICT
modality_id uuid NOT NULL FK app.modality ON DELETE RESTRICT
runner_profile_id uuid NULL FK app.runner_profile ON DELETE RESTRICT
guest_participant_id uuid NULL FK app.guest_participant ON DELETE RESTRICT
buyer_profile_id uuid NOT NULL FK app.runner_profile ON DELETE RESTRICT
registration_number text UNIQUE NOT NULL
status text NOT NULL
confirmed_at timestamptz NOT NULL
canceled_at timestamptz NULL
cancel_reason text NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL

status: CONFIRMED, CANCELED.

CHECK exactamente PROFILE/GUEST.

Unicidad activa por Edition + RunnerProfile y Edition + Guest.

77. CANCEL CONFIRMED REGISTRATION

Command CancelRegistration.

Actor ADMIN/OPERATOR según scope.

No representa refund.

Antes del evento puede permitirse según política operativa. Después de AttendanceFinalization requiere reopen/correction workflow.

Efectos potenciales: Registration CANCELED, liberar capacidad si todavía relevante, ParticipantPass CANCELED, kit review, attendance excluida/reabierta, DistanceCredit reversal si existía, rankings dirty, comunicación opcional y audit.

Nunca DELETE.

78. CHANGE REGISTRATION MODALITY

Command ChangeRegistrationModality.

Self-service fuera V1. Staff puede hacerlo antes de cierre o mediante correction/reopen.

Validar target misma Edition, ACTIVE, elegibilidad, capacidad global, target modality capacity, Category, form requirements, kit impact y official_distance impact.

Transacción: locks, liberar/ocupar capacidad, crear revision, actualizar category, evaluar kit, audit y outbox.

Si DistanceCredit ya existe: reopen/correct/reverse/new credit.

79. REGISTRATION REVISION

app.registration_revision
registration_revision_id uuid PK
registration_id uuid NOT NULL FK app.registration ON DELETE RESTRICT
revision integer NOT NULL
modality_id uuid NOT NULL FK app.modality ON DELETE RESTRICT
category_id uuid NULL FK app.category ON DELETE RESTRICT
status text NOT NULL
effective_from timestamptz NOT NULL
reason text NOT NULL
changed_by_staff_id uuid NOT NULL FK app.staff_member ON DELETE RESTRICT
created_at timestamptz NOT NULL
superseded_at timestamptz NULL

UNIQUE(registration_id,revision).
Una revisión actual.

80. PARTICIPANT PASS

app.participant_pass
participant_pass_id uuid PK
registration_id uuid UNIQUE NOT NULL FK app.registration ON DELETE RESTRICT
public_code text UNIQUE NOT NULL
status text NOT NULL
current_credential_id uuid NULL
issued_at timestamptz NOT NULL
canceled_at timestamptz NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL

status: ACTIVE, CANCELED, REVOKED.

Un Registration tiene un ParticipantPass lógico estable.

81. PARTICIPANT PASS CREDENTIAL

app.participant_pass_credential
participant_pass_credential_id uuid PK
participant_pass_id uuid NOT NULL FK app.participant_pass ON DELETE RESTRICT
version integer NOT NULL
token_hash text UNIQUE NOT NULL
token_ciphertext bytea NOT NULL
encryption_key_version integer NOT NULL
status text NOT NULL
issued_at timestamptz NOT NULL
replaced_at timestamptz NULL
revoked_at timestamptz NULL
created_at timestamptz NOT NULL

UNIQUE(participant_pass_id,version).
status: ACTIVE, REPLACED, REVOKED.

Índice parcial: UNIQUE(participant_pass_id) WHERE status='ACTIVE'.

82. QR CREDENTIAL SECURITY

Al emitir:

- generar token aleatorio de alta entropía;
- calcular hash para validación;
- cifrar token con clave backend versionada;
- guardar ciphertext;
- descartar plaintext fuera de memoria;
- generar QR.

Al mostrar:

- autorización;
- descifrar temporalmente server-side;
- generar representación;
- no loggear token;
- no cache público.

Al escanear:

- hash input;
- buscar credential ACTIVE;
- validar pass.

Secret requerido: PASS_CREDENTIAL_ENCRYPTION_KEY_V1.

Rotación de key debe soportar versionado.

83. PASS REPLACEMENT

ReplaceParticipantPassCredential no crea nuevo ParticipantPass.

Transacción:

- lock pass;
- credential activa -> REPLACED;
- nueva credential version N+1;
- actualizar current_credential_id;
- outbox;
- audit.

Credential anterior deja de autorizar inmediatamente. Historial permanece. Reintento idempotente no crea múltiples activas.

84. PASS ACCESS

RunnerProfile titular puede ver QR propio.
Buyer puede ver QR de Guest bajo su responsabilidad.
Buyer no puede obtener QR secreto de Friend con cuenta.
Staff CHECKIN no necesita plaintext previo; recibe scan y valida.

85. PARTICIPANT PASS SCAN

app.participant_pass_scan
participant_pass_scan_id uuid PK
participant_pass_id uuid NULL FK app.participant_pass ON DELETE RESTRICT
participant_pass_credential_id uuid NULL FK app.participant_pass_credential ON DELETE RESTRICT
edition_id uuid NULL FK app.edition ON DELETE RESTRICT
operation_type text NOT NULL
outcome text NOT NULL
staff_member_id uuid NOT NULL FK app.staff_member ON DELETE RESTRICT
station_key text NULL
scanned_at timestamptz NOT NULL
metadata jsonb NOT NULL DEFAULT '{}'

operation_type: EVENT_CHECKIN, KIT_PICKUP, MANUAL_VERIFY.

outcome: VALID, ALREADY_CHECKED_IN, REVOKED_CREDENTIAL, REPLACED_CREDENTIAL, WRONG_EVENT, REGISTRATION_NOT_CONFIRMED, GUARDIAN_VERIFICATION_REQUIRED, UNKNOWN_PASS, CANCELED_REGISTRATION, NOT_YET_ALLOWED, OTHER_REVIEW.

86. KITS

app.kit_definition
kit_definition_id uuid PK
edition_id uuid NOT NULL FK app.edition ON DELETE RESTRICT
name text NOT NULL
status text NOT NULL
pickup_start_at timestamptz NULL
pickup_end_at timestamptz NULL
instructions text NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL

app.kit_variant
kit_variant_id uuid PK
kit_definition_id uuid NOT NULL FK app.kit_definition ON DELETE RESTRICT
variant_key text NOT NULL
label text NOT NULL
capacity integer NULL CHECK(capacity IS NULL OR capacity>=0)
status text NOT NULL
created_at timestamptz NOT NULL

UNIQUE(kit_definition_id,variant_key).

Ejemplo: shirt_size S/M/L.

87. KIT SELECTION

app.kit_selection
kit_selection_id uuid PK
request_participant_id uuid NOT NULL FK app.registration_request_participant ON DELETE RESTRICT
kit_definition_id uuid NOT NULL FK app.kit_definition ON DELETE RESTRICT
kit_variant_id uuid NOT NULL FK app.kit_variant ON DELETE RESTRICT
selected_at timestamptz NOT NULL
updated_at timestamptz NOT NULL

Selección ocurre antes o durante solicitud. Al confirmar Registration se crea allocation.

88. KIT ALLOCATION

app.kit_allocation
kit_allocation_id uuid PK
registration_id uuid UNIQUE NOT NULL FK app.registration ON DELETE RESTRICT
kit_definition_id uuid NOT NULL FK app.kit_definition ON DELETE RESTRICT
kit_variant_id uuid NOT NULL FK app.kit_variant ON DELETE RESTRICT
status text NOT NULL
assigned_at timestamptz NOT NULL
assigned_by_staff_id uuid NULL FK app.staff_member ON DELETE RESTRICT
notes text NULL
updated_at timestamptz NOT NULL

status: ASSIGNED, READY, DELIVERED, CANCELED, EXCEPTION.

Inventario disponible = variant capacity - allocations activas relevantes.

Cambio talla: staff valida nueva disponibilidad y actualiza allocation de forma auditada.

89. KIT PICKUP

app.kit_pickup
kit_pickup_id uuid PK
registration_id uuid NOT NULL FK app.registration ON DELETE RESTRICT
kit_allocation_id uuid NOT NULL FK app.kit_allocation ON DELETE RESTRICT
participant_pass_credential_id uuid NULL FK app.participant_pass_credential ON DELETE RESTRICT
edition_id uuid NOT NULL FK app.edition ON DELETE RESTRICT
status text NOT NULL
delivered_at timestamptz NOT NULL
delivered_by_staff_id uuid NOT NULL FK app.staff_member ON DELETE RESTRICT
station_key text NULL
verification_method text NOT NULL
third_party_reason text NULL
reversed_at timestamptz NULL
reversed_by_staff_id uuid NULL FK app.staff_member ON DELETE RESTRICT
reversal_reason text NULL

status: DELIVERED, REVERSED.

Máximo una entrega vigente por Registration/kit. Entrega a tercero requiere motivo/verificación explícita. Kit no entregado no implica NO_SHOW.

90. ATTENDANCE CHECKIN

app.attendance_checkin
attendance_checkin_id uuid PK
edition_id uuid NOT NULL FK app.edition ON DELETE RESTRICT
registration_id uuid NOT NULL FK app.registration ON DELETE RESTRICT
participant_pass_credential_id uuid NULL FK app.participant_pass_credential ON DELETE RESTRICT
status text NOT NULL
verification_method text NOT NULL
checked_in_at timestamptz NOT NULL
checked_in_by_staff_id uuid NOT NULL FK app.staff_member ON DELETE RESTRICT
station_key text NULL
reversed_at timestamptz NULL
reversed_by_staff_id uuid NULL FK app.staff_member ON DELETE RESTRICT
reversal_reason text NULL
created_at timestamptz NOT NULL

status: VERIFIED_PRESENT, REVERSED.

Check-in es evidencia operativa, no asistencia final.

91. ATTENDANCE RESOLUTION

app.attendance_resolution
attendance_resolution_id uuid PK
edition_id uuid NOT NULL FK app.edition ON DELETE RESTRICT
registration_id uuid NOT NULL FK app.registration ON DELETE RESTRICT
revision integer NOT NULL
status text NOT NULL
source text NOT NULL
checkin_id uuid NULL FK app.attendance_checkin ON DELETE RESTRICT
reason text NULL
evidence_metadata jsonb NOT NULL DEFAULT '{}'
resolved_by_staff_id uuid NULL FK app.staff_member ON DELETE RESTRICT
resolved_at timestamptz NOT NULL
superseded_at timestamptz NULL

status: PENDING, PRESENT, NO_SHOW, EXCLUDED.
source: INITIAL, CHECKIN, MANUAL, CORRECTION.

Una revisión vigente por Registration.

No scan != NO_SHOW. PRESENT manual exige actor, motivo y evidencia.

92. SPORTING ELIGIBILITY RESOLUTION

Attendance y elegibilidad deportiva son diferentes.

app.sporting_eligibility_resolution
sporting_eligibility_resolution_id uuid PK
registration_id uuid NOT NULL FK app.registration ON DELETE RESTRICT
revision integer NOT NULL
status text NOT NULL
distance_credit_disposition text NOT NULL
reason_code text NULL
reason text NULL
resolved_by_staff_id uuid NULL FK app.staff_member ON DELETE RESTRICT
resolved_at timestamptz NOT NULL
superseded_at timestamptz NULL

status: ELIGIBLE, DISQUALIFIED, EXCLUDED, PENDING_REVIEW.

distance_credit_disposition: ALLOW, DENY, PENDING.

Una persona puede estar PRESENT y DISQUALIFIED. La DQ no borra presencia.

Toda DQ debe tener disposition explícita antes del cierre. PENDING es closure blocker. Esto evita asumir que toda DQ automáticamente borra o conserva kilómetros.

93. ATTENDANCE UNIVERSE

Universo esperado = Registration CONFIRMED vigente - Registration canceladas/excluidas válidamente.

Debe ser reconstruible.

Inicialización:

- checkin activo puede preclasificar PRESENT;
- sin checkin -> PENDING.

Staff resuelve PENDING.

Bulk MarkRemainingNoShow permitido solamente después de confirmar alcance y excepciones. No aplicar a PRESENT/EXCLUDED.

94. ATTENDANCE FINALIZATION

app.attendance_finalization
attendance_finalization_id uuid PK
edition_id uuid NOT NULL FK app.edition ON DELETE RESTRICT
revision integer NOT NULL
status text NOT NULL
expected_count integer NOT NULL
present_count integer NOT NULL
no_show_count integer NOT NULL
excluded_count integer NOT NULL
finalized_by_staff_id uuid NOT NULL FK app.staff_member ON DELETE RESTRICT
finalized_at timestamptz NOT NULL
reopened_at timestamptz NULL
reopened_by_staff_id uuid NULL FK app.staff_member ON DELETE RESTRICT
reopen_reason text NULL
superseded_at timestamptz NULL
created_at timestamptz NOT NULL

UNIQUE(edition_id,revision).
status: FINALIZED, SUPERSEDED.

Índice parcial: UNIQUE(edition_id) WHERE superseded_at IS NULL AND status='FINALIZED'.

Precondiciones: PENDING attendance=0, PENDING sporting eligibility relevante=0 y conteos coinciden con universo.

95. ADMINISTRATIVE CLOSURE

app.administrative_closure
administrative_closure_id uuid PK
edition_id uuid NOT NULL FK app.edition ON DELETE RESTRICT
revision integer NOT NULL
attendance_finalization_id uuid NOT NULL FK app.attendance_finalization ON DELETE RESTRICT
status text NOT NULL
closed_by_staff_id uuid NOT NULL FK app.staff_member ON DELETE RESTRICT
closed_at timestamptz NOT NULL
reopened_at timestamptz NULL
reopened_by_staff_id uuid NULL FK app.staff_member ON DELETE RESTRICT
reopen_reason text NULL
superseded_at timestamptz NULL
created_at timestamptz NOT NULL

UNIQUE(edition_id,revision).
status: CLOSED, SUPERSEDED.

Una revisión vigente cerrada.

96. CLOSURE READINESS

Antes de cerrar:

- execution FINISHED o caso autorizado;
- Registration universe estable;
- AttendanceFinalization vigente;
- no PENDING;
- SportingEligibility resuelta;
- guardian blockers resueltos;
- duplicate Registration blockers resueltos;
- integridad de DistanceCredit lista;
- tasks CLOSURE_BLOCKER resueltas por condición real;
- no correction abierta que afecte resultado.

Task Center no es autoridad; readiness recalcula fuentes.

97. CLOSE EDITION PROTOCOL

CloseEdition:

BEGIN
- lock Edition;
- validar closure no vigente;
- cargar AttendanceFinalization vigente;
- validar blockers;
- crear AdministrativeClosure revision N;
- crear DistanceCredits elegibles idempotentemente o registrar batch asociado al mismo cierre;
- marcar closure_state CLOSED solo cuando la reconciliation requerida esté completa;
- outbox EditionAdministrativelyClosed;
- COMMIT.

Si side effects posteriores fallan, estado durable permanece y outbox reintenta.

98. REOPEN

ReopenEdition requiere ADMIN y reason obligatorio.

Efectos:

- closure vigente -> SUPERSEDED/reopened;
- closure_state PENDING;
- identificar DistanceCredits derivados;
- identificar ranking periods afectados;
- AuditLog;
- outbox EditionAdministrativeClosureReopened.

Corrección produce nuevas revisiones. No sobrescribir antiguas.

99. DISTANCE CREDIT

app.distance_credit
distance_credit_id uuid PK
runner_profile_id uuid NOT NULL FK app.runner_profile ON DELETE RESTRICT
registration_id uuid NOT NULL FK app.registration ON DELETE RESTRICT
edition_id uuid NOT NULL FK app.edition ON DELETE RESTRICT
modality_id uuid NOT NULL FK app.modality ON DELETE RESTRICT
attendance_resolution_id uuid NOT NULL FK app.attendance_resolution ON DELETE RESTRICT
attendance_finalization_id uuid NOT NULL FK app.attendance_finalization ON DELETE RESTRICT
administrative_closure_id uuid NOT NULL FK app.administrative_closure ON DELETE RESTRICT
sporting_eligibility_resolution_id uuid NOT NULL FK app.sporting_eligibility_resolution ON DELETE RESTRICT
official_distance_snapshot_m integer NOT NULL CHECK(official_distance_snapshot_m>0)
credited_distance_m integer NOT NULL CHECK(credited_distance_m>=0)
sport_date date NOT NULL
sport_timezone text NOT NULL
status text NOT NULL
source text NOT NULL
created_at timestamptz NOT NULL
reversed_at timestamptz NULL
reversed_by_staff_id uuid NULL FK app.staff_member ON DELETE RESTRICT
reversal_reason text NULL
supersedes_distance_credit_id uuid NULL FK app.distance_credit ON DELETE RESTRICT

status: ACTIVE, REVERSED.
source: EVENT_ATTENDANCE.

Índice parcial: UNIQUE(registration_id) WHERE status='ACTIVE'.

Guest nunca recibe DistanceCredit.

100. SPORT_DATE

Inicio deportivo efectivo:

- usar local_start_time de Modality cuando exista;
- si no, usar hora de la revisión vigente de Edition;
- combinar con local_date vigente;
- resolver mediante Edition.timezone.

sport_date = fecha local del inicio efectivo en Edition.timezone.

Guardar sport_timezone snapshot.

Nunca usar DistanceCredit.created_at como periodo competitivo.

Si una corrección cambia fecha efectiva, revertir/crear crédito y recalcular periodos afectados.

101. COMPETITIVE ELIGIBILITY

Un DistanceCredit puede existir en historial personal sin ser elegible para ranking público.

Elegibilidad competitiva por crédito:

- RunnerProfile;
- participante adulto al sport_date;
- account compatible con publicación según reglas actuales;
- SportingEligibility disposition ALLOW;
- evento genera kilómetros;
- crédito ACTIVE.

Créditos obtenidos antes de 18 años no entran retroactivamente a ranking competitivo al cumplir 18, aunque permanecen en progreso personal.

102. RANKING EPOCH

app.competition_settings
settings_id smallint PK CHECK(settings_id=1)
timezone text NOT NULL DEFAULT 'America/Monterrey'
ranking_epoch date NULL
ranking_epoch_frozen_at timestamptz NULL
updated_at timestamptz NOT NULL
updated_by_staff_id uuid NULL FK app.staff_member ON DELETE RESTRICT

Al primer crédito competitivo elegible, si ranking_epoch es NULL, establecer sport_date correspondiente mediante transacción.

Después es inmutable en operación ordinaria.

Rebaseline solo ADMIN mediante command extraordinario auditado. No mover epoch silenciosamente por crédito antiguo.

103. RANKING PERIOD

app.ranking_period
ranking_period_id uuid PK
period_type text NOT NULL
period_key text NOT NULL
starts_at timestamptz NOT NULL
ends_at timestamptz NULL
timezone text NOT NULL
status text NOT NULL
created_at timestamptz NOT NULL
consolidating_at timestamptz NULL
closed_at timestamptz NULL

UNIQUE(period_type,period_key).

period_type: WEEKLY, MONTHLY, HISTORICAL_CUT.
status: OPEN, CONSOLIDATING, CLOSED.

WEEKLY: lunes 00:00 a lunes 00:00 America/Monterrey; period_key ISO week-year.
MONTHLY: día 1 00:00 a día 1 siguiente.
HISTORICAL_CUT: corte mensual asociado a cierre mensual.

Historical live es proyección dinámica, no un periodo cerrado único.

104. RANKING PROJECTION

Proyecciones: WEEKLY, MONTHLY, HISTORICAL_LIVE.

Fuente: DistanceCredit ACTIVE elegibles.

No sumar rankings entre sí.

Debe soportar full recomputation.

Datos mínimos: runner_profile_id, credited_distance_m, credit_count, rank_position, last_recomputed_at y ledger_watermark.

Proyección no es resultado oficial.

105. EMPATES

Rank por distancia exacta.

Misma distancia: mismo rank.

Siguiente rank usa competition ranking. Ejemplo 1,1,3.

No usar fecha, edad, cantidad de carreras u orden alfabético como desempate.

Top 3 significa rank_position<=3 y puede contener más de tres personas.

106. RANKING CLOSURE READINESS

Al terminar calendario: OPEN -> CONSOLIDATING.

Antes de CLOSED:

1. identificar todas las Edition que pueden producir DistanceCredit con sport_date dentro del periodo;
2. cada Edition relevante debe estar AdministrativeClosure CLOSED o explícitamente declarada no contributiva;
3. AttendanceFinalization vigente;
4. DistanceCredit reconciliation completa;
5. no CommunityIntegrityCase material abierto;
6. outbox de créditos relevante procesado/reconciliado;
7. full recomputation desde ledger;
8. verificar proyección contra resultado recomputado;
9. establecer ledger watermark;
10. crear snapshot revision;
11. solamente entonces CLOSED.

No cerrar porque simplemente cambió el mes.

107. RANKING SNAPSHOT

app.ranking_snapshot
ranking_snapshot_id uuid PK
ranking_period_id uuid NOT NULL FK app.ranking_period ON DELETE RESTRICT
revision integer NOT NULL
status text NOT NULL
cutoff_at timestamptz NOT NULL
ranking_epoch_snapshot date NOT NULL
ledger_watermark text NOT NULL
eligibility_rule_version integer NOT NULL
generated_at timestamptz NOT NULL
generated_by text NOT NULL
superseded_at timestamptz NULL

UNIQUE(ranking_period_id,revision).
status: CURRENT, SUPERSEDED.

Índice parcial: UNIQUE(ranking_period_id) WHERE status='CURRENT'.

108. RANKING SNAPSHOT ENTRY

app.ranking_snapshot_entry
ranking_snapshot_entry_id uuid PK
ranking_snapshot_id uuid NOT NULL FK app.ranking_snapshot ON DELETE RESTRICT
runner_profile_id uuid NOT NULL FK app.runner_profile ON DELETE RESTRICT
rank_position integer NOT NULL
credited_distance_m bigint NOT NULL
credit_count integer NOT NULL
display_name_snapshot text NOT NULL
avatar_asset_snapshot_id uuid NULL
eligibility_snapshot jsonb NOT NULL
created_at timestamptz NOT NULL

UNIQUE(ranking_snapshot_id,runner_profile_id).

109. HISTORICAL CUT

Cada cierre mensual crea:

- MONTHLY snapshot;
- recomputación de HISTORICAL_LIVE al mismo cutoff;
- HISTORICAL_CUT snapshot.

Historical cut usa créditos competitivos ACTIVE desde ranking_epoch hasta cutoff.

No otorgar achievement histórico por liderar provisionalmente Historical Live.

110. ACHIEVEMENTS V1

Familias obligatorias:

MONTHLY_PODIUM
HISTORICAL_PODIUM_CUT

No badges semanales competitivos V1.

app.achievement_definition
achievement_definition_id uuid PK
key text UNIQUE NOT NULL
family text NOT NULL
place integer NULL
name text NOT NULL
active boolean NOT NULL

Seeds:
MONTHLY_PODIUM_1
MONTHLY_PODIUM_2
MONTHLY_PODIUM_3
HISTORICAL_PODIUM_CUT_1
HISTORICAL_PODIUM_CUT_2
HISTORICAL_PODIUM_CUT_3

111. ACHIEVEMENT GRANT

app.achievement_grant
achievement_grant_id uuid PK
achievement_definition_id uuid NOT NULL FK app.achievement_definition ON DELETE RESTRICT
runner_profile_id uuid NOT NULL FK app.runner_profile ON DELETE RESTRICT
ranking_period_id uuid NULL FK app.ranking_period ON DELETE RESTRICT
ranking_snapshot_id uuid NOT NULL FK app.ranking_snapshot ON DELETE RESTRICT
historical_cutoff_date date NULL
place integer NOT NULL
grant_key text UNIQUE NOT NULL
status text NOT NULL
granted_at timestamptz NOT NULL
revoked_at timestamptz NULL
revoke_reason text NULL
created_at timestamptz NOT NULL

status: ACTIVE, REVOKED.

Solo snapshot oficial CLOSED/CURRENT puede originar grants. Empate concede a todos los rank 1/2/3 legítimos.

112. ACHIEVEMENT RECONCILIATION

Corrección material post-cierre:

- reopen Edition;
- corregir Attendance/Credit;
- DistanceCreditChanged;
- periodo afectado -> CONSOLIDATING revision nueva;
- snapshot anterior SUPERSEDED;
- snapshot nuevo CURRENT;
- comparar grants;
- grant inválido -> REVOKED;
- nuevo legítimo -> ACTIVE.

No DELETE.

113. HOME COMMUNITY

Home muestra después de próximas carreras:

- Top mensual;
- Historical live.

Mensual:
OPEN -> Clasificación provisional.
CONSOLIDATING -> En consolidación.
CLOSED -> Resultado oficial.

Historical muestra desde ranking_epoch y última actualización.

Respetar empates. Menores no aparecen en ranking.

114. PUBLIC PROFILE

Puede mostrar avatar aprobado, nombre, km verificados personales, participaciones verificadas, ranking mensual si elegible, ranking histórico si elegible y achievements ACTIVE.

Distinguir progreso personal de posición competitiva.

115. AVATAR ASSET

app.profile_image_asset
profile_image_asset_id uuid PK
runner_profile_id uuid NOT NULL FK app.runner_profile ON DELETE RESTRICT
staging_object_key text NOT NULL
public_object_key text NULL
status text NOT NULL
uploaded_at timestamptz NOT NULL
processed_at timestamptz NULL
approved_at timestamptz NULL
rejected_at timestamptz NULL
removed_at timestamptz NULL
decided_by_staff_id uuid NULL FK app.staff_member ON DELETE RESTRICT
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL

status: PENDING_PROCESSING, PENDING_REVIEW, APPROVED, REJECTED, REMOVED, SUPERSEDED.

116. AVATAR LIFECYCLE

Si avatar A está APPROVED y usuario sube B, A sigue público mientras B está pendiente.

B rejected: A sigue.

B approved: en transacción A -> SUPERSEDED, B -> APPROVED y CommunityProfile.avatar_asset_id=B.

Si B se retira por infracción: B -> REMOVED, CommunityProfile deja de usarlo, caches se invalidan y se crea AVATAR_UPLOAD_SUSPENSION de tres meses.

No borrar historial de moderación.

117. AVATAR CLOUDINARY

Staging privado. Public contiene solamente assets aprobados normalizados.

Upload:

- signed upload server-side;
- max 8 MB inicial;
- JPEG/PNG/WebP;
- no SVG;
- MIME real;
- límites de píxeles;
- strip EXIF/GPS;
- re-encode;
- 512x512 WebP canonical;
- folders separados: runiis/staging/avatar-pending, runiis/staging/avatar-approved, runiis/production/avatar-pending y runiis/production/avatar-approved;
- no usar unsigned upload preset abierto;
- PENDING_REVIEW.

Contenido retirado debe dejar de servirse públicamente. Definir purga de cache y movimiento/eliminación del objeto público sin destruir evidencia requerida por retención.

118. AVATAR MODERATION

app.avatar_moderation_decision
avatar_moderation_decision_id uuid PK
profile_image_asset_id uuid NOT NULL FK app.profile_image_asset ON DELETE RESTRICT
decision text NOT NULL
staff_member_id uuid NOT NULL FK app.staff_member ON DELETE RESTRICT
reason text NULL
decided_at timestamptz NOT NULL

decision: APPROVE, REJECT, REMOVE.

Queue: foto, nombre, approve, reject. Bulk approve con IDs explícitos.

119. SANCTIONS

app.account_sanction
sanction_id uuid PK
runner_profile_id uuid NOT NULL FK app.runner_profile ON DELETE RESTRICT
sanction_type text NOT NULL
status text NOT NULL
reason text NOT NULL
starts_at timestamptz NOT NULL
ends_at timestamptz NULL
imposed_by_staff_id uuid NOT NULL FK app.staff_member ON DELETE RESTRICT
revoked_at timestamptz NULL
revoked_by_staff_id uuid NULL FK app.staff_member ON DELETE RESTRICT
revoke_reason text NULL
created_at timestamptz NOT NULL

sanction_type: AVATAR_UPLOAD_SUSPENSION, IDENTITY_REVIEW_LOCK, PLATFORM_BAN.

120. IDENTITY LOCK

Nombre abusivo/manipulado:

- account_state IDENTITY_LOCKED;
- bloquear operaciones normales;
- mostrar explicación/contacto WhatsApp;
- soporte humano puede pedir ID externamente;
- no guardar documento sin política aprobada;
- staff corrige full_name;
- audit;
- unlock.

Corrección legítima simple de typo puede hacerse por staff con reason sin activar sanción fuerte.

121. PLATFORM BAN

PLATFORM_BAN es permanente hasta ADMIN unban.

Efectos:

- account_state BANNED;
- Auth ban/session invalidation según capacidad;
- blocked_identity active;
- profile no elegible para búsqueda/comunidad actual;
- no Friends;
- no nuevos requests;
- no puede ser agregado por otro buyer;
- pending requests que lo incluyan entran en revisión/cancelación;
- passes activos/futuros se revocan cuando la sanción impida participación;
- no ranking activo;
- no nuevos achievements;
- no avatar;
- historia interna no se borra;
- Attendance/DistanceCredit histórico se conserva como evidencia.

Unban no revive requests cancelados ni reactiva credentials revocadas automáticamente.

122. BLOCKED IDENTITY

private.blocked_identity
blocked_identity_id uuid PK
runner_profile_id uuid NOT NULL FK app.runner_profile ON DELETE RESTRICT
normalized_email text NULL
oauth_provider text NULL
oauth_subject text NULL
active boolean NOT NULL
created_at timestamptz NOT NULL
revoked_at timestamptz NULL

Before User Created Hook rechaza identidad conocida active.

No afirmar que esto impide a la persona crear una identidad completamente diferente.

123. LEGAL DOCUMENTS

app.legal_document
legal_document_id uuid PK
document_key text UNIQUE NOT NULL
document_type text NOT NULL
status text NOT NULL
created_at timestamptz NOT NULL

document_type: TERMS_OF_SERVICE, PRIVACY_NOTICE, SPORT_WAIVER, MINOR_TERMS, EVENT_RULES.

app.legal_document_version
legal_document_version_id uuid PK
legal_document_id uuid NOT NULL FK app.legal_document ON DELETE RESTRICT
version integer NOT NULL
content_markdown text NULL
public_asset_key text NULL
status text NOT NULL
published_at timestamptz NULL
created_at timestamptz NOT NULL

UNIQUE(legal_document_id,version).

124. LEGAL ACCEPTANCE

app.legal_acceptance
legal_acceptance_id uuid PK
runner_profile_id uuid NOT NULL FK app.runner_profile ON DELETE RESTRICT
legal_document_version_id uuid NOT NULL FK app.legal_document_version ON DELETE RESTRICT
edition_id uuid NULL FK app.edition ON DELETE RESTRICT
registration_request_id uuid NULL FK app.registration_request ON DELETE RESTRICT
participant_runner_profile_id uuid NULL FK app.runner_profile ON DELETE RESTRICT
guardian_assignment_id uuid NULL FK app.guardian_assignment ON DELETE RESTRICT
accepted_at timestamptz NOT NULL
acceptance_context jsonb NOT NULL DEFAULT '{}'

Friendship no autoriza al buyer a aceptar silenciosamente un waiver personal de otro adulto.

Si un Friend adulto necesita aceptación individual, debe existir aceptación vigente propia antes de confirmar.

Para menor, guardian acepta documentos aplicables.

Los textos definitivos son dependencia legal. La arquitectura versionada debe estar lista antes.

125. COMMUNICATION RECIPIENT

La identidad de comunicaciones no se reduce a un email snapshot aislado.

app.communication_recipient
communication_recipient_id uuid PK
recipient_type text NOT NULL
runner_profile_id uuid NULL FK app.runner_profile ON DELETE RESTRICT
guest_participant_id uuid NULL FK app.guest_participant ON DELETE RESTRICT
anonymous_key uuid NULL
created_at timestamptz NOT NULL

recipient_type: RUNNER, GUEST, ANONYMOUS.

CHECK exactamente un target.

126. COMMUNICATION CONTACT POINT

app.communication_contact_point
communication_contact_point_id uuid PK
communication_recipient_id uuid NOT NULL FK app.communication_recipient ON DELETE RESTRICT
channel text NOT NULL
value_normalized text NOT NULL
verification_status text NOT NULL
verified_at timestamptz NULL
is_primary boolean NOT NULL
status text NOT NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL

channel: EMAIL.
status: ACTIVE, RETIRED.
verification_status: UNVERIFIED, VERIFIED.

Cambio de email debe producir un nuevo ContactPoint o proceso versionado; no sobrescribir evidencia de consentimiento histórico sin trazabilidad.

127. COMMUNICATION CONSENT

Consentimiento es append-only.

app.communication_consent
communication_consent_id uuid PK
communication_recipient_id uuid NOT NULL FK app.communication_recipient ON DELETE RESTRICT
purpose text NOT NULL
action text NOT NULL
legal_document_version_id uuid NULL FK app.legal_document_version ON DELETE RESTRICT
source text NOT NULL
occurred_at timestamptz NOT NULL
metadata jsonb NOT NULL DEFAULT '{}'

purpose: GENERAL_MARKETING, EVENT_REMINDER, OTHER_OPTIONAL.
action: GRANTED, WITHDRAWN.

Preferencia efectiva se deriva del último hecho aplicable y suppression.

No borrar historial. Secuencia GRANTED -> WITHDRAWN -> GRANTED conserva los tres hechos.

128. COMMUNICATION PREFERENCE

Puede existir proyección:

app.communication_preference
communication_recipient_id uuid PK FK app.communication_recipient ON DELETE RESTRICT
marketing_allowed boolean NOT NULL
updated_at timestamptz NOT NULL

Es proyección; no evidencia legal única.

129. FAVORITES

app.edition_interest
runner_profile_id uuid NOT NULL FK app.runner_profile ON DELETE RESTRICT
edition_id uuid NOT NULL FK app.edition ON DELETE RESTRICT
interest_type text NOT NULL
created_at timestamptz NOT NULL

PRIMARY KEY(runner_profile_id,edition_id,interest_type).
interest_type: FAVORITE.

Favorito no implica marketing.

130. REMINDERS

app.event_reminder_subscription
event_reminder_subscription_id uuid PK
edition_id uuid NOT NULL FK app.edition ON DELETE RESTRICT
communication_recipient_id uuid NOT NULL FK app.communication_recipient ON DELETE RESTRICT
reminder_type text NOT NULL
status text NOT NULL
created_at timestamptz NOT NULL
confirmed_at timestamptz NULL
canceled_at timestamptz NULL

status: PENDING_CONFIRMATION, ACTIVE, CANCELED, COMPLETED.

Anonymous reminder por email verificado está permitido. Debe confirmar email antes de ACTIVE.

Si luego crea cuenta, puede consolidarse Recipient/ContactPoint mediante flujo verificado; no por coincidencia insegura.

Recordatorio no equivale a newsletter.

131. COMMUNICATION TEMPLATE

app.communication_template
communication_template_id uuid PK
template_key text UNIQUE NOT NULL
category text NOT NULL
active_version integer NOT NULL
created_at timestamptz NOT NULL

app.communication_template_version
communication_template_version_id uuid PK
template_id uuid NOT NULL FK app.communication_template ON DELETE RESTRICT
version integer NOT NULL
subject_template text NOT NULL
html_template text NOT NULL
text_template text NOT NULL
variable_schema jsonb NOT NULL
created_at timestamptz NOT NULL

UNIQUE(template_id,version).

category: SECURITY, TRANSACTIONAL, OPERATIONAL, REMINDER, MARKETING.

132. AUTOMATION RULE

app.communication_automation_rule
communication_automation_rule_id uuid PK
rule_key text UNIQUE NOT NULL
trigger_event text NOT NULL
template_key text NOT NULL
category text NOT NULL
priority integer NOT NULL
recipient_policy text NOT NULL
consent_policy text NOT NULL
scheduling_policy jsonb NOT NULL DEFAULT '{}'
dedupe_policy jsonb NOT NULL
active boolean NOT NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL

No guardar código arbitrario ejecutable en DB.

133. CATÁLOGO DE COMUNICACIONES V1

AUTH_OTP:
trigger solicitud Auth.
destino auth email.
seguridad.
prioridad P0.
Gestionado por Supabase SMTP pero contabilizado operativamente.

ANONYMOUS_REMINDER_CONFIRMATION:
trigger solicitud Recordarme anónima.
requiere verificación.
no marketing.

NEW_EDITION:
trigger primera publicación si staff solicita campaña.
audiencia marketing permitida.
No enviar automáticamente por publicar.

REGISTRATION_OPENED:
trigger apertura.
audiencia reminder subscribers relevantes.
Cancelar/reprogramar si Edition cambia.

REGISTRATION_CONFIRMED:
trigger Registration confirmada.
Runner recibe propio; Guest al buyer.
P1.

MULTI_REGISTRATION_BUYER_SUMMARY:
resumen buyer de solicitud múltiple.
No sustituye mensajes individuales.

GUARDIAN_REQUIRED:
acción requerida de guardian.
Operativo.

T_MINUS_7:
confirmados.
Operativo.
Reprogramable.

T_MINUS_24:
confirmados.
Operativo.
Reprogramable.

KIT_INFORMATION:
participantes relevantes.

MATERIAL_EVENT_CHANGE:
afectados.

POSTPONED:
confirmados y reminders aplicables.

RESCHEDULED:
confirmados.

CANCELED:
confirmados.
P0 operativo.

BIRTHDAY:
solamente adultos con GENERAL_MARKETING vigente.
P3.
No menores.

POST_EVENT:
solamente cuando finalidad y consentimiento correspondan.

Mensajes PSP financieros: fuera V1.

134. COMMUNICATION CAMPAIGN

app.communication_campaign
communication_campaign_id uuid PK
campaign_type text NOT NULL
edition_id uuid NULL FK app.edition ON DELETE RESTRICT
template_key text NOT NULL
status text NOT NULL
purpose text NOT NULL
created_by_staff_id uuid NOT NULL FK app.staff_member ON DELETE RESTRICT
audience_definition jsonb NOT NULL
estimated_recipient_count integer NULL
scheduled_for timestamptz NULL
created_at timestamptz NOT NULL
started_at timestamptz NULL
completed_at timestamptz NULL
canceled_at timestamptz NULL

status: DRAFT, READY, SCHEDULED, SENDING, COMPLETED, CANCELED, FAILED.

135. CAMPAIGN RECIPIENT

app.communication_campaign_recipient
communication_campaign_recipient_id uuid PK
campaign_id uuid NOT NULL FK app.communication_campaign ON DELETE RESTRICT
communication_recipient_id uuid NOT NULL FK app.communication_recipient ON DELETE RESTRICT
snapshot_status text NOT NULL
exclusion_reason text NULL
created_at timestamptz NOT NULL

UNIQUE(campaign_id,communication_recipient_id).

El snapshot registra candidatos. Antes del dispatch se revalida contact active, verified, consent, suppression, account policy y quota.

Una persona que retira consentimiento después del snapshot no debe recibir el mensaje.

136. COMMUNICATION MESSAGE

app.communication_message
communication_message_id uuid PK
dedupe_key text UNIQUE NOT NULL
recipient_id uuid NOT NULL FK app.communication_recipient ON DELETE RESTRICT
contact_point_id uuid NOT NULL FK app.communication_contact_point ON DELETE RESTRICT
template_key text NOT NULL
template_version integer NOT NULL
category text NOT NULL
priority integer NOT NULL
purpose text NOT NULL
source_type text NOT NULL
source_id uuid NULL
edition_id uuid NULL FK app.edition ON DELETE RESTRICT
registration_id uuid NULL FK app.registration ON DELETE RESTRICT
participant_pass_id uuid NULL FK app.participant_pass ON DELETE RESTRICT
campaign_id uuid NULL FK app.communication_campaign ON DELETE RESTRICT
render_context_snapshot jsonb NOT NULL
rendered_subject_snapshot text NOT NULL
status text NOT NULL
scheduled_for timestamptz NOT NULL
created_at timestamptz NOT NULL
sent_at timestamptz NULL
last_error text NULL

status: QUEUED, SENDING, SENT, DELIVERED, BOUNCED, COMPLAINED, FAILED, CANCELED, WAITING_FOR_QUOTA.

Nunca guardar QR token plaintext en render_context_snapshot.

Cambiar nombre del evento o template después no modifica evidencia de lo enviado.

137. DELIVERY ATTEMPT

app.communication_delivery_attempt
communication_delivery_attempt_id uuid PK
communication_message_id uuid NOT NULL FK app.communication_message ON DELETE RESTRICT
provider text NOT NULL
provider_message_id text NULL
status text NOT NULL
attempt_number integer NOT NULL
attempted_at timestamptz NOT NULL
resolved_at timestamptz NULL
error_code text NULL
error_detail_safe text NULL

138. PROVIDER EVENT

infra.communication_provider_event
communication_provider_event_id uuid PK
provider text NOT NULL
provider_event_id text NOT NULL
provider_message_id text NULL
event_type text NOT NULL
received_at timestamptz NOT NULL
authenticated boolean NOT NULL
payload_safe jsonb NOT NULL
processed_at timestamptz NULL
processing_status text NOT NULL

UNIQUE(provider,provider_event_id).

Evento no autenticado no modifica estado.
Evento duplicado es inocuo.
Evento fuera de orden no degrada una verdad más reciente.
Evento desconocido queda investigable.

139. SUPPRESSION

app.communication_suppression
suppression_id uuid PK
contact_point_id uuid NOT NULL FK app.communication_contact_point ON DELETE RESTRICT
reason text NOT NULL
scope text NOT NULL
source text NOT NULL
active boolean NOT NULL
created_at timestamptz NOT NULL
resolved_at timestamptz NULL
resolved_by_staff_id uuid NULL FK app.staff_member ON DELETE RESTRICT
resolution_reason text NULL

reason: HARD_BOUNCE, SPAM_COMPLAINT, INVALID_ADDRESS, GLOBAL_OPTIONAL_OPTOUT, LEGAL_RESTRICTION, PROVIDER_SUPPRESSION, ADMIN_SAFETY_BLOCK, CONTACT_RETIRED.

scope: ALL_EMAIL, OPTIONAL_ONLY, MARKETING_ONLY.

Complaint/hard bounce sin bypass trivial.

140. PROVIDER USAGE

app.communication_provider_usage
usage_id uuid PK
provider text NOT NULL
usage_date date NOT NULL
sent_total integer NOT NULL
sent_security integer NOT NULL
sent_operational integer NOT NULL
sent_reminder integer NOT NULL
sent_marketing integer NOT NULL
daily_limit_snapshot integer NULL
monthly_limit_snapshot integer NULL
updated_at timestamptz NOT NULL

UNIQUE(provider,usage_date).

No asumir un límite eterno en código. Antes de producción verificar condiciones actuales del proveedor.

141. EMAIL PRIORITY

P0: OTP, seguridad, cancelación urgente.
P1: Registration confirmation, Pass, cambios críticos.
P2: reminders solicitados, kit.
P3: marketing/campañas.

Dispatcher no permite que P3 consuma capacidad reservada para P0/P1.

Si capacidad insuficiente para operación crítica, crear alerta/gate; no retrasar silenciosamente varios días.

142. ADMIN TASK

app.admin_task
admin_task_id uuid PK
task_key text UNIQUE NOT NULL
category text NOT NULL
scope_type text NOT NULL
scope_id uuid NULL
edition_id uuid NULL FK app.edition ON DELETE RESTRICT
related_entity_type text NULL
related_entity_id uuid NULL
title text NOT NULL
description text NOT NULL
priority text NOT NULL
blocking_level text NOT NULL
status text NOT NULL
assigned_role text NULL
assigned_staff_id uuid NULL FK app.staff_member ON DELETE RESTRICT
detected_at timestamptz NOT NULL
due_at timestamptz NULL
started_at timestamptz NULL
resolved_at timestamptz NULL
resolution_type text NULL
resolution_reason text NULL
source_rule text NOT NULL
metadata jsonb NOT NULL DEFAULT '{}'
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL

status: OPEN, IN_PROGRESS, WAITING_EXTERNAL, RESOLVED, WAIVED.
blocking_level: INFORMATION, ACTION_REQUIRED, EVENT_DAY_BLOCKER, CLOSURE_BLOCKER.

CLOSURE_BLOCKER no puede cerrarse visualmente sin resolver fuente.

143. TASK RULES

Mínimo:

attendance-finalization:{edition}
closure-integrity:{edition}:{case}
kit-size-missing:{edition}:{registration}
duplicate-registration:{edition}:{signature}
avatar-review-overdue:{asset}
communication-critical-failure:{message}
ranking-integrity:{period}:{case}

Request WhatsApp normal no genera Task individual.

144. STAFF MEMBER Y ROLES

app.staff_member
staff_member_id uuid PK
auth_user_id uuid UNIQUE NOT NULL FK auth.users ON DELETE RESTRICT
status text NOT NULL
created_at timestamptz NOT NULL

status: ACTIVE, REVOKED.

app.staff_role_assignment
staff_role_assignment_id uuid PK
staff_member_id uuid NOT NULL FK app.staff_member ON DELETE RESTRICT
role text NOT NULL
scope_type text NOT NULL
edition_id uuid NULL FK app.edition ON DELETE RESTRICT
created_at timestamptz NOT NULL
created_by_staff_id uuid NULL FK app.staff_member ON DELETE RESTRICT
revoked_at timestamptz NULL
revoked_by_staff_id uuid NULL FK app.staff_member ON DELETE RESTRICT

scope_type: GLOBAL, EDITION.

Roles: ADMIN, OPERATOR, CHECKIN, MODERATOR.

145. RBAC MATRIX

ADMIN GLOBAL:

- staff roles;
- global settings;
- todos los eventos;
- publish;
- capacidades;
- sanciones;
- bans;
- exports;
- closure/reopen;
- legal publication;
- campaigns;
- audit según necesidad.

ADMIN EDITION, si se usa scope:

- recursos de esa Edition;
- no global settings;
- no grants globales.

OPERATOR:

- event content;
- modalities;
- price;
- capacity;
- requests;
- registrations;
- kits;
- attendance;
- comunicaciones operativas;
- participant list.

Export PII requiere permiso explícito o scope definido.

OPERATOR no puede PLATFORM_BAN ni conceder roles globales.

CHECKIN:

- scanner;
- lookup mínimo;
- check-in;
- guardian verification si se autoriza.

CHECKIN no exporta PII ni edita precio/cupo.

MODERATOR:

- avatar queue;
- approve/reject/remove;
- avatar suspension según workflow.

MODERATOR no necesita PII operativa completa.

146. AUDIT LOG

audit.audit_log
audit_log_id uuid PK
actor_auth_user_id uuid NULL
actor_staff_member_id uuid NULL
actor_role text NULL
action text NOT NULL
entity_type text NOT NULL
entity_id uuid NULL
edition_id uuid NULL
before_snapshot jsonb NULL
after_snapshot jsonb NULL
reason text NULL
correlation_id uuid NULL
request_id uuid NULL
occurred_at timestamptz NOT NULL

Append-only.

Auditar roles, name corrections, sanctions, ban/unban, publish, schedule, capacity, price, request confirmation/cancel/revalidation, Registration cancel/change, pass replacement, kit, guardian verification, manual attendance, DQ, finalization, closure/reopen, credit reversal, ranking revision, achievements, avatar, legal publication y campaigns.

147. OUTBOX

infra.outbox_event
outbox_event_id uuid PK
event_type text NOT NULL
aggregate_type text NOT NULL
aggregate_id uuid NOT NULL
effect_key text NOT NULL
payload jsonb NOT NULL
status text NOT NULL
available_at timestamptz NOT NULL
attempt_count integer NOT NULL DEFAULT 0
claimed_by text NULL
claimed_at timestamptz NULL
claim_expires_at timestamptz NULL
processed_at timestamptz NULL
last_error text NULL
created_at timestamptz NOT NULL

UNIQUE(effect_key).
status: PENDING, PROCESSING, PROCESSED, FAILED, ESCALATED.

148. OUTBOX RECOVERY

Claim mediante FOR UPDATE SKIP LOCKED.

Al claim guardar claimed_by y claim_expires_at.

PROCESSING con claim_expires_at vencido puede reclamarse.

Retry usa backoff exponencial + jitter.

Max attempts configurable por effect type.

Al superar: ESCALATED y AdminTask si es relevante.

No prometer exactly-once externo. Objetivo: at-least-once + efecto idempotente + reconciliación.

149. IDEMPOTENCY

infra.idempotency_record
idempotency_record_id uuid PK
actor_auth_user_id uuid NULL
operation_key text NOT NULL
resource_scope text NOT NULL
idempotency_key text NOT NULL
request_hash text NOT NULL
state text NOT NULL
lease_owner text NULL
lease_expires_at timestamptz NULL
response_status integer NULL
response_body jsonb NULL
created_at timestamptz NOT NULL
expires_at timestamptz NOT NULL

UNIQUE(actor_auth_user_id,operation_key,resource_scope,idempotency_key).

SYSTEM operations usan namespace propio.

Same key/same hash: retornar resultado original.
Same key/different hash: 409 IDEMPOTENCY_CONFLICT.

Antes de devolver respuesta cacheada, verificar que actor actual siga autorizado.

150. WORKER RUN

infra.worker_run
worker_run_id uuid PK
worker_key text NOT NULL
started_at timestamptz NOT NULL
completed_at timestamptz NULL
status text NOT NULL
processed_count integer NOT NULL DEFAULT 0
error_count integer NOT NULL DEFAULT 0
cursor_metadata jsonb NOT NULL DEFAULT '{}'
metadata jsonb NOT NULL DEFAULT '{}'

status: RUNNING, SUCCEEDED, PARTIAL, FAILED.

151. DOMAIN EVENTS

Mínimo:

ProfileReady
FriendshipRequested
FriendshipAccepted
GuestArchived
EditionPublished
EditionRegistrationOpened
EditionPostponed
EditionRescheduled
EditionCanceled
PriceOfferChanged
CapacityChanged
RoutePublished
RegistrationRequestCreated
RegistrationRequestExpired
RegistrationRequestCanceled
RegistrationConfirmed
RegistrationCanceled
RegistrationModalityChanged
ParticipantPassIssued
ParticipantPassCredentialReplaced
KitDelivered
AttendanceCheckinRecorded
AttendanceFinalized
SportingEligibilityResolved
EditionAdministrativeClosureReopened
EditionAdministrativelyClosed
DistanceCreditGranted
DistanceCreditReversed
RankingPeriodConsolidating
RankingPeriodClosed
RankingSnapshotCreated
RankingSnapshotSuperseded
AchievementGranted
AchievementRevoked
AvatarSubmitted
AvatarApproved
AvatarRejected
AvatarRemoved
AccountIdentityLocked
AccountBanned
AccountUnbanned
CommunicationQueued
CommunicationDelivered
CommunicationFailed

Consumers deben ser idempotentes.

152. WORKERS

expire-registration-requests: cada 5 min; materializa EXPIRED y libera claims/holds. expires_at sigue siendo autoridad.

close-registration-windows: cada 5 min.

outbox-dispatch: frecuencia corta compatible con runtime.

communication-reconcile: cada 15 min.

task-center-reconcile: cada 10 min.

ranking-projection-refresh: event driven + fallback 15 min.

ranking-period-manager: cada 15 min.

archive-guests: diario.

avatar-processing: event/background.

avatar-orphan-cleanup: diario.

integrity-scan: cada hora.

provider-usage-reconcile: diario/frecuencia necesaria.

Mecanismo de disparo (ADR-002):

- Workers DB-only (expire-registration-requests, close-registration-windows, archive-guests): pg_cron ejecuta la función SQL private.worker_<key>() y la ejecución se registra en infra.worker_run.
- Workers HTTP (outbox-dispatch cada 1 min, issue-pending-credentials cada 5 min, communication-reconcile cada 15 min, provider-usage-reconcile diario a las 00:05 UTC): pg_cron + pg_net envían POST /api/internal/workers/<key> con Authorization Bearer INTERNAL_CRON_SECRET. La URL base y el secreto viven en Supabase Vault por entorno (runiis_worker_base_url, runiis_worker_cron_secret); un entorno sin esas entradas no dispara nada.
- No se usan Vercel Cron ni funciones programadas de Netlify (retiradas del código).
- Tolerancia de latencia: los workers P0/P1 toleran minutos; un disparo perdido se recupera en el siguiente tick. Los workers son idempotentes (claims con lease y FOR UPDATE SKIP LOCKED, dedupe_key), por lo que un disparo duplicado es inocuo.
- Los workers aún no implementados se disparan sobre este mismo mecanismo.

153. RANKING PERIOD MANAGER

No cierra automáticamente por reloj.

Responsabilidades:

- crear Weekly/Monthly;
- OPEN -> CONSOLIDATING al pasar end;
- evaluar readiness;
- full recompute;
- snapshot;
- achievements;
- CLOSED.

Si readiness falla, permanece CONSOLIDATING y crea Task/Integrity issue.

154. COMMUNITY INTEGRITY CASE

app.community_integrity_case
community_integrity_case_id uuid PK
case_type text NOT NULL
runner_profile_id uuid NULL FK app.runner_profile ON DELETE RESTRICT
edition_id uuid NULL FK app.edition ON DELETE RESTRICT
registration_id uuid NULL FK app.registration ON DELETE RESTRICT
distance_credit_id uuid NULL FK app.distance_credit ON DELETE RESTRICT
ranking_period_id uuid NULL FK app.ranking_period ON DELETE RESTRICT
status text NOT NULL
severity text NOT NULL
blocking_level text NOT NULL
detected_at timestamptz NOT NULL
resolved_at timestamptz NULL
resolution text NULL
audit_correlation_id uuid NULL
metadata jsonb NOT NULL DEFAULT '{}'

Tipos: DUPLICATE_DISTANCE_CREDIT, CREDIT_WITHOUT_FINAL_ATTENDANCE, CREDIT_WITHOUT_VALID_CLOSURE, DISTANCE_MISMATCH, MULTIPLE_CREDITS_SAME_EDITION, INVALID_SPORT_DATE, RANKING_PROJECTION_MISMATCH, ACHIEVEMENT_BASIS_INVALID, UNAUTHORIZED_MANUAL_CORRECTION.

Caso material bloquea cierre.

155. PLATFORM SETTINGS

app.platform_settings
settings_id smallint PK CHECK(settings_id=1)
timezone text NOT NULL DEFAULT 'America/Monterrey'
default_whatsapp_phone_e164 text NOT NULL
registration_hold_minutes integer NOT NULL DEFAULT 1440
registration_close_offset_minutes integer NOT NULL DEFAULT 2880
email_otp_expiry_seconds integer NOT NULL DEFAULT 600
availability_low_threshold_percent numeric NULL
updated_at timestamptz NOT NULL
updated_by_staff_id uuid NULL FK app.staff_member ON DELETE RESTRICT

Default cierre: 48 horas antes.

Al crear Edition se materializa registration_close_at. Cambiar default no reescribe Editions automáticamente.

156. RLS PRINCIPLES

Deny by default.

Cada tabla expuesta debe tener RLS activo.

No exponer private, audit ni infra directamente al cliente.

No usar service secret en browser.

No usar user_metadata editable por usuario como autorización.

Policies evalúan auth.uid y helpers seguros.

Columnas privilegiadas se modifican mediante commands server-side; RLS por fila no sustituye control de columnas.

157. RLS HELPERS

private.current_profile_id()
private.current_staff_member_id()
private.is_profile_ready()
private.is_profile_active()
private.has_staff_role(role,edition_id)
private.is_admin_global()
private.owns_guest(guest_id)
private.friendship_accepted(other_profile_id)

Si una función usa SECURITY DEFINER:

- schema private;
- search_path explícito;
- PUBLIC EXECUTE revocado;
- grants mínimos;
- tests negativos.

158. RLS MATRIX PRINCIPAL

runner_profile:
anon sin acceso.
authenticated SELECT own.
UPDATE directo restringido; preferir command.
staff scoped.
system full.

community_profile:
anon SELECT visible.
auth SELECT visible/own.
no privileged direct update client.

friendship:
solo partes involucradas SELECT.
requester puede crear PENDING mediante command.
addressee acepta/rechaza.
ambos pueden remover.

guest_participant:
owner acceso lógico.
staff scope Edition cuando exista relación.
no public.

guardian_assignment:
minor/guardian acceso mínimo necesario.
staff scope.
no public.

event/edition/modality/price/route:
solo published projections para anon.
drafts staff.

registration_request:
buyer own.
staff scope.
no others.

registration_request_participant:
buyer ve resumen de request.
Friend incluido puede conocer su inclusión cuando sea necesario sin ver datos de otros.
staff scope.

registration:
titular own.
buyer puede ver contexto de Registrations originadas por request propio sin obtener secretos ajenos.
staff scope.

participant_pass:
titular.
buyer solo Guest.
staff validation endpoint.

attendance:
writes staff/system.
lectura personal básica si UX la expone.

distance_credit:
runner own detail.
public solo aggregate/projection.
writes system.

ranking:
public projection/snapshot.
writes system.

avatar:
owner submission.
public solo APPROVED current.
moderator writes.

sanctions:
usuario puede conocer restricción efectiva necesaria para UX.
razones internas staff/admin.
ban ADMIN.

communications:
recipient own preferences/reminders.
campaign staff.
provider event system.

audit:
staff autorizado read-only.
no client writes.

159. GRANTS

anon recibe SELECT solamente sobre tablas/views públicas necesarias.

authenticated recibe permisos mínimos.

No otorgar UPDATE directo donde el dominio exige command.

Backend secret únicamente en server environment.

Preferir views públicas para impedir exposición accidental de columnas privadas.

160. COLUMN SECURITY

runner_profile user-editable ordinariamente:

- phone_e164;
- emergency_contact_name;
- emergency_contact_phone_e164;
- emergency_contact_relationship.

No user-editable directo:

- full_name;
- auth_user_id;
- account_state;
- profile_readiness;
- date_of_birth después de READY salvo support workflow.

Staff commands aplican validación y AuditLog.

161. CRITICAL CONSTRAINTS

Debe existir enforcement verificable para:

1. Edition global_capacity >=0;
2. modality capacity >=0;
3. price >=0;
4. hold quantity >0;
5. hold expires_at > created_at;
6. official_distance >0 cuando genera km;
7. PROFILE/GUEST exclusive;
8. Guardian target exclusive;
9. un request PENDING efectivo por buyer + Edition;
10. un participant claim efectivo por Edition;
11. duplicate confirmed Registration bloqueada;
12. un ParticipantPass lógico por Registration;
13. una credential ACTIVE por pass;
14. una AttendanceResolution current;
15. una SportingEligibilityResolution current;
16. una AttendanceFinalization current por Edition;
17. una AdministrativeClosure current por Edition;
18. un DistanceCredit ACTIVE por Registration;
19. un RankingSnapshot CURRENT por period;
20. Friendship sin self;
21. Friendship duplicada inversa bloqueada;
22. un avatar APPROVED current;
23. un avatar PENDING_REVIEW current;
24. CampaignRecipient unique;
25. ProviderEvent unique;
26. Outbox effect_key unique;
27. Guest sin DistanceCredit;
28. cross-edition references coherentes.

No over-selling requiere transacciones y locks, no solamente constraints estáticos.

162. ON DELETE POLICY

Principio general: RESTRICT para entidades históricas y operativas.

CASCADE solo para hijos puramente técnicos de un objeto DRAFT cuya eliminación está permitida y no tenga historia externa.

Después de PUBLISHED/CONFIRMED, utilizar archive/status/revision, no DELETE.

163. INDEXES ESENCIALES

runner_profile:
UNIQUE(auth_user_id).
trigram/search_name.

community_profile:
UNIQUE(public_profile_id).
(is_visible,is_searchable,competition_status).

edition:
UNIQUE(slug).
(publication_state,registration_state).
(registration_close_at).

schedule_revision:
(edition_id,revision).
partial current.

modality:
(edition_id,status).

price_offer:
(modality_id,status,starts_at,ends_at,priority).

registration_request:
UNIQUE(public_reference).
(buyer_profile_id,status).
(edition_id,status,expires_at).
partial buyer pending.

registration_hold:
(modality_id,status,expires_at).

registration:
(edition_id,status).
(modality_id,status).
partial unique edition/profile.
partial unique edition/guest.

pass credential:
UNIQUE(token_hash).
partial unique active per pass.

attendance:
(edition_id,status).
(registration_id,revision).

closure/finalization:
(edition_id,revision).
partial current.

distance_credit:
(runner_profile_id,status,sport_date).
partial unique active registration.

ranking:
(period_type,period_key).
entries by snapshot/rank.

communications:
status/scheduled_for.
provider_message_id.

tasks:
UNIQUE(task_key).
(edition_id,status,priority).

outbox:
(status,available_at).
(claim_expires_at).

164. API CONVENTIONS

Base: /api/v1.

Formato JSON salvo CSV/export.

Colecciones grandes usan cursor pagination.

Respuesta estándar:

{
  "data": ...,
  "meta": ...
}

Error:

{
  "error": {
    "code": "...",
    "message": "...",
    "request_id": "...",
    "details": {}
  }
}

No stack trace al cliente.

Mutaciones críticas aceptan Idempotency-Key.

Recursos administrativos versionados pueden aceptar expected_revision o If-Match.

165. PUBLIC API

GET /api/v1/events

Query:
q
type
date_from
date_to
distance_min_m
distance_max_m
location
price
registration_open
cursor
limit

GET /api/v1/events/:slug
GET /api/v1/rankings?type=WEEKLY|MONTHLY|HISTORICAL&period=
GET /api/v1/profiles/:publicProfileId
GET /api/v1/legal/:documentKey

166. ACCOUNT API

GET /api/v1/me
PATCH /api/v1/me/profile

PATCH permite únicamente campos autorizados.

GET /api/v1/people?q=&cursor=

GET /api/v1/me/friends
POST /api/v1/friendships
POST /api/v1/friendships/:id/accept
POST /api/v1/friendships/:id/reject
DELETE /api/v1/friendships/:id

GET /api/v1/me/guests
POST /api/v1/me/guests
PATCH /api/v1/me/guests/:id

167. REGISTRATION API

POST /api/v1/registration-requests

Request conceptual:

edition_id
participants[
  {
    kind,
    runner_profile_id|guest_participant_id,
    modality_id,
    category_id?,
    responses{}
  }
]
legal_acceptances[]

Response:

registration_request_id
public_reference
status
expires_at
total_snapshot
whatsapp_url nullable
participants summary

Errors:

PROFILE_INCOMPLETE
ACCOUNT_BANNED
IDENTITY_LOCKED
REGISTRATION_NOT_OPEN
REGISTRATION_CLOSED
EDITION_NOT_REGISTRABLE
MODALITY_NOT_AVAILABLE
PARTICIPANT_NOT_ELIGIBLE
GUARDIAN_REQUIRED
DUPLICATE_REGISTRATION
PARTICIPANT_ALREADY_HELD
CAPACITY_UNAVAILABLE
GLOBAL_CAPACITY_UNAVAILABLE
FORM_INVALID
LEGAL_ACCEPTANCE_REQUIRED

GET /api/v1/registration-requests/:id
GET /api/v1/me/registration-requests
POST /api/v1/registration-requests/:id/cancel

168. PASS API

GET /api/v1/me/passes
GET /api/v1/me/passes/:passId
POST /api/v1/me/passes/:passId/render-qr

Render requiere autorización y no permite public cache.

POST /api/v1/admin/passes/:passId/replace-credential

169. ADMIN EVENTS API

GET /api/v1/admin/events
POST /api/v1/admin/events
POST /api/v1/admin/events/:eventId/editions
PATCH /api/v1/admin/editions/:editionId
POST /api/v1/admin/editions/:editionId/publish
POST /api/v1/admin/editions/:editionId/open-registration
POST /api/v1/admin/editions/:editionId/pause-registration
POST /api/v1/admin/editions/:editionId/resume-registration
POST /api/v1/admin/editions/:editionId/close-registration
POST /api/v1/admin/editions/:editionId/postpone
POST /api/v1/admin/editions/:editionId/reschedule
POST /api/v1/admin/editions/:editionId/cancel
POST /api/v1/admin/editions/:editionId/modalities
PATCH /api/v1/admin/modalities/:id
PATCH /api/v1/admin/modalities/:id/capacity
POST /api/v1/admin/editions/:editionId/capacity (capacidad global de la Edition; implementado así)
POST /api/v1/admin/modalities/:id/prices
PATCH /api/v1/admin/prices/:id

170. ADMIN ROUTE API

POST /api/v1/admin/editions/:editionId/routes
POST /api/v1/admin/routes/:routeId/import-gpx
POST /api/v1/admin/routes/:routeId/revisions
PATCH /api/v1/admin/route-revisions/:revisionId
POST /api/v1/admin/route-revisions/:revisionId/validate
POST /api/v1/admin/route-revisions/:revisionId/publish
POST /api/v1/admin/routes/:routeId/duplicate

GPX import crea DRAFT y nunca auto-publica.

171. ADMIN REQUESTS

GET /api/v1/admin/editions/:editionId/registration-requests
POST /api/v1/admin/registration-requests/:id/confirm
POST /api/v1/admin/registration-requests/:id/revalidate-and-confirm
POST /api/v1/admin/registration-requests/:id/cancel

Confirm es idempotente.

172. ADMIN PARTICIPANTS

GET /api/v1/admin/editions/:editionId/participants

Filtros: status, modality, attendance, kit, type, search.

GET /api/v1/admin/editions/:editionId/participants/export.csv

Export requiere permiso superior y genera audit.

POST /api/v1/admin/registrations/:id/cancel
POST /api/v1/admin/registrations/:id/change-modality

173. AVATAR API

POST /api/v1/me/avatar/upload-url
POST /api/v1/me/avatar/submit
GET /api/v1/me/avatar/status
DELETE /api/v1/me/avatar

GET /api/v1/admin/avatar-submissions
POST /api/v1/admin/avatar-submissions/:id/approve
POST /api/v1/admin/avatar-submissions/:id/reject
POST /api/v1/admin/avatar-submissions/:id/remove
POST /api/v1/admin/avatar-submissions/bulk-approve

174. RACE DAY API

POST /api/v1/check-in

Request:
edition_id
credential_token
station_key

Response:
outcome
participant minimal
registration status
guardian state
timestamp

Manual lookup:
GET /api/v1/admin/editions/:editionId/participants/search?q=

Kit:
POST /api/v1/admin/kits/pickup
POST /api/v1/admin/kits/pickup/:id/reverse

175. ATTENDANCE API

GET /api/v1/admin/editions/:editionId/attendance
POST /api/v1/admin/registrations/:id/attendance/resolve
POST /api/v1/admin/registrations/:id/sporting-eligibility/resolve
POST /api/v1/admin/editions/:id/attendance/finalize
POST /api/v1/admin/editions/:id/attendance/reopen
POST /api/v1/admin/editions/:id/close
POST /api/v1/admin/editions/:id/reopen

176. COMMUNICATION API

User:

POST /api/v1/events/:editionId/favorite
DELETE /api/v1/events/:editionId/favorite
POST /api/v1/events/:editionId/reminders
DELETE /api/v1/reminders/:id
GET /api/v1/reminders/challenge
POST /api/v1/reminders
POST /api/v1/reminders/confirm
PATCH /api/v1/me/communication-preferences

Admin:

GET /api/v1/admin/communications/messages
GET /api/v1/admin/communications/campaigns
POST /api/v1/admin/communications/campaigns
POST /api/v1/admin/communications/campaigns/:id/preview
POST /api/v1/admin/communications/campaigns/:id/schedule
POST /api/v1/admin/communications/campaigns/:id/send
POST /api/v1/admin/communications/campaigns/:id/cancel

Webhook:
POST /api/webhooks/brevo

POST /api/webhooks/brevo es el adaptador del EmailProvider activo (Brevo); el contrato de dominio de Communication sigue siendo neutral al proveedor y otro proveedor tendría su propio adaptador bajo /api/webhooks/<proveedor>.

Recordatorio anónimo: GET /api/v1/reminders/challenge entrega el desafío ALTCHA; POST /api/v1/reminders exige la solución en el campo altcha además de los límites por IP y por email (SEC-082, ADR-002). POST /api/v1/reminders/confirm confirma el consentimiento con el token del email.

177. SANCTION API

POST /api/v1/admin/users/:profileId/avatar-suspend
POST /api/v1/admin/users/:profileId/identity-lock
POST /api/v1/admin/users/:profileId/identity-unlock
POST /api/v1/admin/users/:profileId/ban
POST /api/v1/admin/users/:profileId/unban
PATCH /api/v1/admin/users/:profileId/name

Ban/unban ADMIN.

178. ERROR TAXONOMY

400 VALIDATION_ERROR
401 AUTH_REQUIRED
403 FORBIDDEN
404 NOT_FOUND
409 CONFLICT
410 RESOURCE_EXPIRED
422 BUSINESS_RULE_VIOLATION
429 RATE_LIMITED
500 INTERNAL_ERROR
503 DEPENDENCY_UNAVAILABLE

Specific:

CAPACITY_UNAVAILABLE
GLOBAL_CAPACITY_UNAVAILABLE
REGISTRATION_NOT_OPEN
REGISTRATION_CLOSED
REQUEST_EXPIRED
PRICE_CHANGED
DUPLICATE_REGISTRATION
PARTICIPANT_ALREADY_HELD
PARTICIPANT_NOT_ELIGIBLE
GUARDIAN_REQUIRED
GUARDIAN_VERIFICATION_REQUIRED
ACCOUNT_BANNED
IDENTITY_LOCKED
AVATAR_UPLOAD_SUSPENDED
PASS_REVOKED
PASS_REPLACED
ALREADY_CHECKED_IN
CLOSURE_BLOCKED
RANKING_NOT_READY
IDEMPOTENCY_CONFLICT

179. RATE LIMITS

Valores iniciales configurables:

people search: 60 / 10 min / user.
friend request: 5/min y 30/day.
registration request: 5/10 min/user y 1 effective PENDING por Edition.
avatar upload: 5/day.
admin mutations: 120/min/staff más safeguards.
OTP: 6 digits, 10 minutes, 60 seconds mínimo entre solicitudes.

Los valores son configuración y pueden ajustarse por evidencia sin alterar el producto.

180. PROVIDER FAILURES

Email down:
Registration permanece confirmada. Message queda queued/retry. Pass sigue disponible.

Cloudinary down:
current avatar permanece. new upload falla/retry. No afecta inscripción.

Tiles down:
dirección, venue y CTA siguen. Map fallback.

Analytics down:
sin impacto funcional.

Sentry down:
sin impacto funcional.

Scheduler down:
estado durable permanece. backlog observable. siguiente run puede reclamar.

181. FOUNDATIONS VISUALES

Dirección: Performance Editorial.
Light-first.

Base:
paper #F6F7F3
ink #0B0D0E
signal lime #D7FF3F

Tipografía:
Archivo Narrow para hero, H1, H2, grandes números y podios.
Inter para body, forms, buttons, labels, admin y tablas.

No dark mode global V1.

182. TYPOGRAPHY TOKENS

Mobile:

display-xl Archivo Narrow 700 48/46.
h1 Archivo Narrow 700 40/42.
h2 Archivo Narrow 700 32/36.
h3 Inter 700 26/32.
h4 Inter 650 22/28.
body-lg Inter 400 18/28.
body Inter 400 16/24.
body-sm 14/20.
label 14/18 600.
caption 12/16.
button 15/20 600.

Desktop:

display-xl 80/76.
h1 56/58.
h2 44/48.
h3 32/38.
h4 24/30.
body same.

Fluid:
display-xl clamp(48px,6vw,80px)
h1 clamp(40px,4.5vw,56px)
h2 clamp(32px,3.5vw,44px)

Body no fluid.

Usar tabular nums en precios, km, rankings, fechas/tiempos y dashboard cuando aporte legibilidad.

183. ICONOGRAPHY

Lucide.

Grid 24.
Sizes: 16 metadata, 20 controls, 24 navigation, 28–32 important status, 40–48 simple empty states.
Stroke 1.75 default.

Icon-only requiere accessible name.
Estado usa icon + text + color.
No emoji como iconografía de producto.

184. RUNLINE

Firma gráfica secundaria.

2px normal.
4px strong.
rounded caps.
signal/neutral.

Usos: active underline, stepper, progreso, comunidad editorial y pass detail.

No usar como fondo ornamental repetitivo.

185. GRID

Breakpoints:
base 0–479
sm 480–767
md 768–1023
lg 1024–1279
xl 1280–1439
2xl >=1440

Public grid:
base 4 cols margin16 gutter12.
sm 4 margin24 gutter16.
md 8 margin32 gutter20.
lg 12 margin40 gutter24.
xl 12 max1280 gutter24.

Containers:
public.max 1280.
reading.max 760.
registration.max 1040.
modal.form.max 640.
admin.content fluid con máximo recomendado1600.

186. SPACING

Base 4.

0=0
1=4
2=8
3=12
4=16
5=20
6=24
8=32
10=40
12=48
16=64
20=80
24=96
32=128

Aliases:
control.inline 8
control.stack 12
field.stack 16
field.group 24
card.mobile 16
card.desktop 24
section.mobile 48
section.desktop 80
page.top.mobile 24
page.top.desktop 48

187. RADII, BORDERS Y SHADOW

radius:
xs6
sm10
control12
card16
panel20
overlay24
hero28
full999

Borders before shadows.

Divider 1px #D6DBDE.
Control 1px #7C878D semantic equivalent.
Selected 2px cuando sea útil.

shadow.sm 0 1px 2px rgba(11,13,14,.06)
shadow.md 0 8px 24px rgba(11,13,14,.10)
shadow.lg 0 20px 56px rgba(11,13,14,.16)

Focus no se comunica solo con sombra.

188. MOTION

Motion funcional y moderado.

70ms micro response.
110ms fast state.
150ms control transition.
240ms panel/card.
400ms transición mayor excepcional.

Respetar prefers-reduced-motion.
No infinite ornamental movement.
No retrasar comprensión de estado por animación.
Scanner feedback inmediato.

189. RESPONSIVE

Mobile-first.

Touch target efectivo >=44px.

Filtros en drawer/bottom sheet mobile.

Sticky event CTA permitido/recomendado cuando ayuda decisión.

Tablas admin deben preservar columnas importantes y adaptar interacción; horizontal scroll solo cuando semánticamente apropiado.

Route editor complejo desktop/tablet preferido; mobile read-only/limited.

Scanner mobile optimized.

190. ACCESSIBILITY

Objetivo WCAG 2.2 AA.

Requiere keyboard, focus visible, labels, errors asociados, contraste, reduced motion, estado no color-only, targets, alt text, map fallback accesible y QR con fallback textual/public_code.

191. PERFORMANCE

p75:
LCP <=2.5s
INP <=200ms
CLS <=0.1

Budgets:
hero mobile ideal <=220KB, hard <=300KB.
hero desktop ideal <=400KB, hard <=500KB.
EventCard mobile <=80KB.
EventCard desktop <=120KB.
avatar target <=40KB.
above-fold mobile images <=500KB.
fonts <=140KB.
public own JS ideal <=160KB gzip, hard<=200KB.

Admin bundle separado. MapLibre lazy.

192. INFRASTRUCTURE DECISION STATUS

Supabase:
seleccionado V1 para DB/Auth/RLS/PostGIS.
No suscripción obligatoria inicial.
Production gate verifica cuotas y términos actuales.

Vercel:
hosting objetivo V1 (decisión del propietario, 2026-10-01).
Production gate verifica plan, términos de uso frente a §11 (OWN-01), capacidad y límites en la fecha de despliegue.
Si deja de ser apto, se sustituye HostingRuntime sin cambiar contratos de dominio.

Netlify:
legado: placeholder público y rollback hasta cutover validado. No recibe arquitectura nueva.
Su retiro (dominio, variables, sitio) requiere cutover validado y aprobación final del propietario (OPEN-05).

Brevo:
seleccionado como email transport/SMTP inicial.
Production gate verifica quota, API y webhook.
Communication domain permanece provider-independent.

Cloudinary:
seleccionado como proveedor de media.
Production gate verifica términos, free tier, quota, costos, cache y signed uploads server-side.

MapLibre:
renderer seleccionado.

OpenFreeMap:
tiles iniciales.
Production gate verifica uso y disponibilidad.

PostHog:
opcional analytics.

Sentry:
opcional error monitoring.

GitHub:
repo/CI.

193. CREDENTIALS REQUIRED LATER

No incluir valores reales en este archivo.

Supabase:
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
SUPABASE_URL
SUPABASE_SECRET_KEY
SUPABASE_PROJECT_REF
SUPABASE_ACCESS_TOKEN
DATABASE_URL

Google:
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET

Vercel (hosting objetivo):
VERCEL_TOKEN, VERCEL_ORG_ID y VERCEL_PROJECT_ID solo si CLI/API automation lo requiere; se gestionan por SalvaOps y nunca llegan a la aplicación.

Netlify (legado hasta su retiro, OPEN-05):
NETLIFY_SITE_ID y NETLIFY_AUTH_TOKEN solo para rollback o retiro.

Brevo:
BREVO_API_KEY
BREVO_SMTP_LOGIN
BREVO_SMTP_KEY
BREVO_SENDER_EMAIL
BREVO_SENDER_NAME
BREVO_WEBHOOK_AUTH_SECRET

Cloudinary:
NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME
CLOUDINARY_API_KEY
CLOUDINARY_API_SECRET

Application:
APP_ENV (local | staging | production; obligatoria en todo entorno)
APP_BASE_URL
PASS_CREDENTIAL_ENCRYPTION_KEY_V1
INTERNAL_CRON_SECRET (obligatoria en todo entorno; el valor de cada entorno también se guarda en Supabase Vault como runiis_worker_cron_secret, ADR-002)
EMAIL_DELIVERY_MODE (live | allowlist | capture; sin valor resuelve a capture fuera de producción y a rechazo de envíos en producción)
EMAIL_ALLOWLIST (obligatoria con EMAIL_DELIVERY_MODE=allowlist)

No usadas por la aplicación: CRON_SECRET (el scheduler no es Vercel Cron) y DEFAULT_WHATSAPP_PHONE_E164 (retirada; el número por defecto vive en PlatformSettings.default_whatsapp_phone_e164, PEND-OPS-001).

PostHog:
NEXT_PUBLIC_POSTHOG_KEY
NEXT_PUBLIC_POSTHOG_HOST

Sentry:
NEXT_PUBLIC_SENTRY_DSN
SENTRY_ORG
SENTRY_PROJECT
SENTRY_AUTH_TOKEN si upload de sourcemaps.

Dominio/DNS:
acceso externo al proveedor.

194. CREDENTIALS NOT NEEDED V1

No solicitar:

STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
MERCADOPAGO_ACCESS_TOKEN
MERCADOPAGO_CLIENT_SECRET
APPLE_CLIENT_SECRET
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
REKOGNITION
MAPTILER_API_KEY
TWILIO
WHATSAPP_BUSINESS_TOKEN

195. ENVIRONMENTS

local
preview
staging
production

Reglas:

- production secrets nunca en preview;
- separar DB/proyectos cuando sea viable;
- preview no envía campañas reales;
- staging email usa recipients seguros;
- object storage usa namespaces/buckets separados;
- analytics etiqueta entorno;
- migrations avanzan en orden;
- no compartir SERVICE/SECRET keys entre entornos sin necesidad.

Modelo de entornos (decisión del propietario, 2026-09-27; mapeo a Vercel y Supabase en ADR-002):

- Local: Next local, Supabase Docker, Mailpit, EMAIL_DELIVERY_MODE=capture. Es el entorno de desarrollo y de verificación (pruebas DB, integración, E2E).
- Staging: rama git staging, Vercel Preview con el dominio staging.runiismty.com asignado a la rama, APP_ENV=staging, backend Supabase remoto no productivo y no autoritativo, EMAIL_DELIVERY_MODE=allowlist con la dirección de la cuenta del propietario. Solo build, UI y smoke no destructivo.
- Preview genérico (otras ramas y PR): sin base de datos ni secretos de servidor de producción, valores no productivos, EMAIL_DELIVERY_MODE=capture, deployments protegidos por la autenticación de Vercel.
- Production: rama main, Vercel Production, runiismty.com, APP_ENV=production, EMAIL_DELIVERY_MODE=live, Supabase de producción como único remoto autoritativo (acceso por SalvaOps).
- Las variables de Vercel se separan por entorno: ninguna variable con valor de producción se comparte con Preview.
- robots.txt, los metadatos y el encabezado X-Robots-Tag son noindex siempre que APP_ENV != production.

196. BACKUP AND RECOVERY

DB:

- usar backups disponibles del proveedor;
- definir export strategy adicional antes de producción;
- realizar restore test a entorno aislado.

Object storage:

- referencias viven en DB;
- definir inventory/export/backup de objetos requeridos;
- no asumir que backup DB restaura media.

Repo:
GitHub.

Secrets:
secret stores autorizados.

Restore test debe comprobar:

- relaciones DB;
- Pass credential decryptability con keys restauradas;
- referencias Cloudinary;
- documentos legales;
- audit;
- rankings;
- outbox.

RPO/RTO se fija antes de producción según riesgo de Race Day.

197. OBSERVABILITY

Métricas mínimas:

active_holds
temporarily_unavailable_modalities
expired_request_backlog
oldest_pending_request_age
registration_confirmation_rate
outbox_pending_count
outbox_oldest_age
worker_failed_count
communication_critical_backlog
provider_quota_remaining
avatar_pending_count
avatar_oldest_age
attendance_pending_count
closure_pending_count
distance_credit_integrity_cases
ranking_consolidating_age
ranking_last_refresh
media_provider_errors
auth_error_rate
scanner_error_rate

Alertas mínimas:

- worker stale;
- outbox stale;
- P0 communication failed;
- capacity integrity mismatch;
- ranking consolidation overdue;
- quota threshold.

198. ANALYTICS

Eventos candidatos:

view_home
view_event_list
search_events
filter_events
view_event
start_registration
registration_request_created
whatsapp_handoff
registration_request_canceled
registration_confirmed
free_registration_confirmed
search_people
friend_request_sent
friendship_accepted
view_profile
view_ranking
favorite_added
reminder_created

No enviar email, phone, DOB, emergency, guardian, QR token ni datos de identidad sensible.

199. MIGRATIONS

Orden conceptual:

001 foundations_extensions
002 schemas_privileges
003 auth_profile
004 community_friends_guests_guardians
005 staff_rbac_sanctions
006 legal_settings
007 event_type_event
008 edition_schedule_location_agenda
009 modalities_categories_forms
010 capacity_pricing
011 routes_content_media
012 registration_requests_holds_claims
013 registration_confirmation_registration_revision
014 passes_credentials
015 kits
016 attendance_sporting_eligibility
017 closure_distance_credit
018 ranking_integrity_achievements
019 avatar
020 communication_contacts_consents
021 communication_templates_campaigns_messages
022 tasks
023 audit_outbox_idempotency
024 helper_functions
025 rls_grants
026 indexes_views
027 auth_hooks
028 seeds

Physical filenames usan timestamp generado por Supabase CLI.

200. MIGRATION RULES

No manual production schema drift.

Todo cambio DB:

- migration;
- local reset;
- DB tests;
- advisor/lint;
- review;
- verificación local reproducible (Supabase Docker; el Supabase remoto staging no es autoritativo ni un paso obligatorio);
- production, vía SalvaOps y solo con artefactos que pasaron la verificación local.

Separar data migration de schema migration cuando el volumen lo requiera.

201. SEEDS

Seed:

- event types;
- platform settings singleton;
- competition settings singleton;
- achievement definitions;
- legal document keys;
- catálogos estáticos.

No seedear usuarios reales, secrets o PII.

202. TEST TRACEABILITY

Cada requisito crítico tiene ID y mapa:

Requirement -> command/data -> test -> gate.

Ejemplos:

CAP-001 global capacity -> CreateRegistrationRequest -> CAP-001-DB + CAP-001-INT -> Gate Registration.

PASS-001 one active credential -> DB + replacement integration + security -> Gate Registration/Race Day.

RANK-001 period cannot close with contributing Edition pending -> integration + worker -> Gate Community.

COMM-001 consent revalidated at send -> integration -> Gate Communications.

203. UNIT TESTS

Framework recomendado: Vitest.

Cobertura:

- search normalization;
- filter semantics;
- availability states;
- global capacity;
- modality capacity;
- price selection;
- expiry;
- revalidation;
- profile readiness;
- age;
- guardian;
- Friendship state;
- form validation;
- Category derivation;
- WhatsApp URL;
- pass credential crypto service;
- kit inventory;
- attendance transitions;
- sporting eligibility;
- sport_date;
- weekly/monthly boundaries;
- epoch;
- ranking ties;
- snapshot readiness;
- achievements;
- consent derivation;
- campaign eligibility;
- outbox backoff;
- idempotency hashing;
- cache invalidation mapping.

204. DATABASE TESTS

Usar pgTAP/Supabase cuando corresponda.

Casos obligatorios:

- FK inválidas;
- cross-edition modality/category references;
- duplicate Friendship inverse;
- duplicate participant claim;
- two users competing last global slot;
- two modalities exceeding global capacity;
- duplicate Registration;
- duplicate active pass credential;
- old credential rejected;
- duplicate current AttendanceResolution;
- duplicate current SportingEligibility;
- duplicate current Finalization;
- duplicate current Closure;
- duplicate active DistanceCredit;
- Guest credit rejected;
- duplicate current RankingSnapshot;
- RLS allow/deny.

205. RLS TESTS

anon:

- ve Event/Edition publicada;
- no ve draft;
- ve CommunityProfile visible;
- no ve teléfono/DOB.

authenticated A:

- ve RunnerProfile propio;
- no private RunnerProfile B;
- ve Friendship propia;
- no Friendship B-C;
- ve Guest propio;
- no Guest ajeno;
- ve Request propio;
- no Request ajeno;
- ve Registration propia;
- no secret QR de Friend.

Buyer:

- ve Guest pass;
- no credential Friend.

CHECKIN:

- check-in permitido;
- no capacity edit;
- no participant export;
- no ban.

MODERATOR:

- avatar queue;
- no participant sensitive data irrelevante.

OPERATOR:

- confirm request scope;
- no platform ban.

ADMIN:
ban/unban.

BANNED:
no new request y no bypass al ser agregado por otro buyer.

206. INTEGRATION TESTS

External WhatsApp:
Event -> Request -> Hold -> wa.me -> Admin confirm -> Registrations -> Pass/Credential -> Outbox -> Email.

Expiry:
expires_at pasa antes de worker -> command lo trata expired.
worker corre -> mismo resultado.
revalidate -> success/fail por capacidad/precio.

Global capacity:
requests simultáneos entre modalidades.

FREE:
confirmación atómica.

Friends:
search -> request -> accept -> group registration -> QR ownership separado.

Guest:
adult y minor guardian.

Pass:
render después de restart.
replace dos veces.
old QR rejected.

Attendance:
checkin, PRESENT manual, NO_SHOW, EXCLUDED.

DQ:
PRESENT + DISQUALIFIED + disposition.

Closure:
retry/timeout no duplica credits.

Ranking:
fin de mes con Edition pendiente permanece CONSOLIDATING.
tras cierre -> snapshot -> achievements.

Corrección:
reopen -> credit change -> snapshot revision -> grants reconcile.

Communication:
withdraw consent after campaign candidate snapshot -> no send.
duplicate webhook -> no duplicate transition.
out-of-order provider event -> no regression.

207. E2E

Playwright.

Public:
Home, biblioteca, filtros, búsqueda, Event, status states, routes, responsive, SEO smoke.

Account:
Auth, onboarding, Friends, Guests, guardian, registration, countdown, WhatsApp, cancel, passes, profile, ranking, avatar.

Admin:
Event create, publication readiness, open registration, capacity, price, GPX, requests, confirm, participants, export permission, kit, check-in, attendance, DQ, finalize, close, reopen, avatar moderation, ban, campaign.

Run mobile/desktop, keyboard, reduced motion y accessibility scan.

208. SECURITY TESTS

- RLS allow/deny;
- BOLA/IDOR;
- privilege escalation;
- role scope;
- secret leakage;
- SQL injection;
- XSS;
- rich text sanitization;
- malicious GPX/XML protections;
- avatar MIME spoof;
- image bomb;
- EXIF/GPS removal;
- QR brute-force resistance;
- QR replay;
- credential replacement;
- encryption key handling;
- idempotency cross-user collision;
- CSRF where relevant;
- webhook authentication;
- rate limits;
- ban mid-session;
- blocked signup;
- shared-cache privacy;
- CSV/formula injection in exports.

209. LOAD AND CONCURRENCY

Herramienta open source como k6.

Escenarios:

- 100 users reading events;
- 50 simultaneous registration requests;
- 20 competing for last 5 modality spots;
- cross-modality competition against global capacity;
- 100 QR scans in short window;
- people search;
- participant admin table;
- ranking reads.

Prioridad: integridad antes que throughput artificial.

210. GATE 0 — DEFINITION FREEZE

Debe cumplirse:

- Master V2 aprobado;
- V1/V2 separados;
- no P0 documental pendiente;
- terminología canónica;
- audit resolution register completo.

211. GATE 1 — DATA AND SECURITY

- migrations reproducibles;
- schemas;
- constraints;
- RLS;
- RBAC;
- Auth;
- Before User Created Hook;
- pass credential crypto;
- DB tests;
- secret scan.

212. GATE 2 — EVENT AND PUBLIC

- Event/Edition/Modality/Category;
- schedule revisions;
- locations/agenda;
- capacity global/modality;
- price;
- forms;
- routes/GPX;
- Home/library/Event;
- SEO;
- cache;
- foundations baseline.

213. GATE 3 — REGISTRATION

- onboarding;
- Friends;
- Guests;
- guardians;
- request;
- claims;
- hold 24h;
- expiry deterministic;
- FREE;
- WhatsApp;
- admin confirmation;
- revalidate expired;
- Registration;
- Pass/Credential.

214. GATE 4 — COMMUNICATIONS

- ContactPoint;
- Consent ledger;
- reminder;
- templates;
- automations;
- campaigns;
- messages;
- provider events;
- suppression;
- quota;
- retry/recovery.

215. GATE 5 — RACE DAY

- scanner;
- credential validation;
- guardian;
- kits;
- manual lookup;
- online fallback;
- staff scopes.

216. GATE 6 — CLOSURE

- AttendanceResolution;
- SportingEligibility;
- Finalization revisions;
- Closure revisions;
- DistanceCredit;
- reopen/correction;
- audit.

217. GATE 7 — COMMUNITY

- profile;
- ranking live;
- ranking readiness;
- snapshots;
- historical cut;
- MONTHLY_PODIUM;
- HISTORICAL_PODIUM_CUT;
- avatar lifecycle;
- sanctions/ban effects.

218. GATE 8 — PRODUCTION

- legal final;
- credentials;
- DNS;
- current provider terms/capacity verified;
- email capacity adequate;
- backup restore;
- RPO/RTO;
- E2E;
- accessibility;
- security;
- concurrency/load;
- monitoring;
- no unresolved critical blockers.

219. DEFINITION OF DONE POR FUNCIONALIDAD

Una funcionalidad material requiere:

- requirement;
- actor;
- preconditions;
- data;
- migration;
- constraints;
- RLS/RBAC;
- command/API;
- transition;
- side effects;
- audit;
- idempotency;
- errors;
- UI states;
- tests;
- acceptance evidence.

UI sola no es Done.

220. DEFINITION OF DONE DEL SISTEMA

PASS:

- migrations reproducible;
- DB reset;
- DB tests;
- RLS tests;
- unit;
- integration;
- E2E;
- accessibility;
- security;
- concurrency;
- critical load;
- no over-selling;
- no duplicate Registration;
- one active QR credential;
- QR recoverable after restart;
- expiry deterministic independent of worker;
- no Guest credits;
- closure retry safe;
- ranking close safe;
- historical achievements active;
- communication consent traceable;
- ban effective;
- removed avatar not publicly served;
- backup/restore validated;
- legal production ready;
- secrets configured;
- provider capacity validated.

221. PENDIENTES EXTERNOS

PEND-LEGAL-001:
Terms definitivos.
Owner abogado.
No bloquea arquitectura/desarrollo.
Sí bloquea producción.

PEND-LEGAL-002:
Privacy/retention.
Owner abogado.
No bloquea arquitectura base.
Sí bloquea producción.

PEND-BRAND-001:
logo/assets finales.
No bloquea arquitectura.
Bloquea final polish.

PEND-INFRA-001:
credenciales reales por entorno (Production y Staging separados).
No bloquea mocks/local.
Bloquea integración real.

PEND-INFRA-002:
dominio/DNS. runiismty.com está registrado en Vercel con DNS en Vercel; el cambio de DNS de producción (cutover desde el placeholder de Netlify) sigue pendiente.
No bloquea desarrollo.
Bloquea producción.

PEND-DOMAIN-RENEWAL:
renovación de runiismty.com (registrado en Vercel, expira 2027-09-24, renovación automática desactivada). Renovar implica un pago: decisión del propietario (OWN-02).
No bloquea desarrollo.
Bloquea la continuidad del dominio.

PEND-HOSTING-001:
reconfirmar los términos de uso de Vercel frente a §11 (OWN-01) antes de la apertura pública de ediciones de pago EXTERNAL_WHATSAPP.
No bloquea desarrollo ni Preview.
Bloquea esa apertura pública.

PEND-OPS-001:
número WhatsApp default real.
No bloquea desarrollo.
Bloquea producción.

PEND-EMAIL-001:
validar capacidad del proveedor frente al máximo esperado.
No bloquea desarrollo.
Bloquea apertura real si no hay capacidad crítica.

PEND-RECOVERY-001:
RPO/RTO.
No bloquea desarrollo.
Bloquea production readiness.

222. CLAUDE ORCHESTRATION ENVELOPE

ESTADO: HISTÓRICO. Este modelo de orquestación fue sustituido por SalvaOps Web Development con un orquestador nuevo por fase; el plan de ejecución vigente es docs/RUNIIS_EXECUTION_ROADMAP_V1.md. Se conserva solo para impedir que el modelo anterior se reintroduzca. La última frase de esta sección (no autoriza deploy productivo, credenciales, campañas, DNS ni compras) sigue vigente.

Claude es orquestador.

Debe:

- dividir trabajo por dominios;
- respetar dependencias;
- dar a cada agente contrato aplicable;
- evitar modificaciones concurrentes incompatibles;
- asignar ownership temporal de migrations/archivos críticos;
- exigir evidencia;
- revisar output;
- ejecutar tests;
- integrar;
- detectar regresiones;
- no redefinir producto.

Este documento no autoriza automáticamente deploy productivo, credenciales no entregadas, campañas reales, DNS o compra de servicios.

223. ORDEN DE IMPLEMENTACIÓN

ESTADO: HISTÓRICO como plan de ejecución. Sustituido por el Execution Roadmap por resultados (docs/RUNIIS_EXECUTION_ROADMAP_V1.md); la lista conserva valor solo como grafo de dependencias.

1. repository/tooling;
2. Supabase local;
3. schemas/migrations;
4. Auth/onboarding;
5. RLS/RBAC;
6. legal/settings skeleton;
7. Event/schedule/location;
8. Modality/Category/forms;
9. capacity/pricing;
10. route editor/GPX;
11. discovery;
12. Friends/Guests/Guardians;
13. requests/holds/claims;
14. FREE/external flows;
15. Registration/Pass credentials;
16. communications;
17. kits;
18. scanner/check-in;
19. attendance/sporting eligibility;
20. closure/credits;
21. rankings/achievements;
22. avatar/sanctions;
23. Task Center;
24. analytics/observability;
25. hardening;
26. full tests;
27. production gate.

224. SOURCES OF TRUTH

Auth: Supabase Auth.
Person: RunnerProfile.
Public identity: CommunityProfile.
Edition schedule: current EditionScheduleRevision.
Event: Event.
Occurrence: Edition.
Option: Modality.
Category: RegistrationCategoryAssignment.
Price shown for request: RequestParticipant price snapshot.
Capacity: Edition.global_capacity + ModalityCapacity + confirmed Registrations + effective Holds.
Request: RegistrationRequest.
Confirmed place: Registration.
Pass identity: ParticipantPass.
QR active credential: ParticipantPassCredential ACTIVE.
Kit: KitAllocation + KitPickup.
Presence evidence: AttendanceCheckin.
Final presence: AttendanceResolution current.
Sport eligibility: SportingEligibilityResolution current.
Final attendance set: AttendanceFinalization current.
Administrative closure: AdministrativeClosure current.
Kilometers: DistanceCredit ACTIVE.
Ranking live: Projection derived from ledger.
Official period result: RankingSnapshot CURRENT.
Achievement: AchievementGrant.
Avatar: ProfileImageAsset APPROVED current.
Consent: CommunicationConsent ledger + suppression.
Message: CommunicationMessage + DeliveryAttempt.
Task: AdminTask is projection, not underlying truth.
Audit: AuditLog.

225. NON-AUTHORITATIVE ELEMENTS

Nunca son autoridad por sí solos:

- browser counters;
- WhatsApp chat;
- email enviado;
- analytics;
- cache;
- EventCard;
- Task state alone;
- QR scan aislado;
- total_km mutable;
- available_slots mutable;
- ranking cache;
- provider dashboard.

226. AUDIT FINDINGS RESOLUTION REGISTER

H01 resuelto por jerarquía de autoridad, source map, registro de decisiones sustituidas y pending register.
H02 resuelto por Infrastructure Decision Status con selección técnica delegada y production revalidation gate.
H03 resuelto por guardian verification obligatoria uniforme, Guest-minor y política explícita vigente de visibilidad de menores.
H04 resuelto por ParticipantPass + ParticipantPassCredential versionada.
H05 resuelto por credential cifrada recuperable + hash de validación.
H06 resuelto por expires_at como autoridad y revalidate-and-confirm explícito.
H07 resuelto por global capacity + modality capacity.
H08 resuelto por matrices de precondiciones create/confirm/revalidate/FREE.
H09 resuelto por EditionScheduleRevision y transitions explícitas.
H10 resuelto por PriceOffer determinista y snapshots.
H11 resuelto por CategoryAssignment y RegistrationForm/Response versionado.
H12 resuelto por Route/Revision/GPX/editor completo, agenda y locations.
H13 resuelto por search/filter semantics, URL state, availability y empty/error states.
H14 resuelto por PROFILE_INCOMPLETE -> READY.
H15 resuelto por reglas de linking/collision/recovery.
H16 resuelto por Guest data completos, Guest minors y archive future-aware.
H17 resuelto por Friendship transitions server-controlled y proyección mínima en group registration.
H18 resuelto por RBAC action/scope matrix.
H19 resuelto por PLATFORM_BAN effects y unban rules.
H20 resuelto por AttendanceResolution + SportingEligibilityResolution y no-scan != no-show.
H21 resuelto por versioned Finalization/Closure y FKs directas desde DistanceCredit.
H22 resuelto por CancelRegistration y ChangeRegistrationModality.
H23 resuelto por KitVariant inventory, allocation y pickup invariants.
H24 resuelto por fórmula sport_date y timezone snapshot.
H25 resuelto por Ranking Closure Readiness.
H26 resuelto por MONTHLY_PODIUM + HISTORICAL_PODIUM_CUT obligatorios.
H27 resuelto por ranking_epoch estable y minor competition no retroactiva.
H28 resuelto por catálogo ejecutable de comunicaciones.
H29 resuelto por ContactPoint + Consent append-only + anonymous reminders.
H30 resuelto por Campaign lifecycle.
H31 resuelto por message source links + render snapshots.
H32 resuelto por usage ledger + priority reservation.
H33 resuelto por outbox lease/reclaim/backoff/escalation.
H34 resuelto por actor/operation/resource-scoped idempotency.
H35 resuelto por ProviderEvent ledger y adapter semantics.
H36 resuelto por FK/ON DELETE/constraints ampliados y RLS/grants.
H37 resuelto por contratos API de commands materiales y errores.
H38 resuelto por Foundations tokens, grid, spacing, radii, motion y responsive restaurados.
H39 resuelto por avatar replacement/publication/removal/cache/object lifecycle.
H40 resuelto por cache classification e invalidation events.
H41 resuelto por environments, backup/restore, worker recovery y provider gates.
H42 resuelto por Claude orchestration envelope separado de autorización operativa.
H43 resuelto por requirement-to-test traceability.
H44 resuelto por pending register con impacto/gate.

227. PAIN POINTS Y RESPUESTAS DE DISEÑO

PP-001. El participante no sabe si todavía conserva sus lugares.
Respuesta: RegistrationRequest visible en Mi cuenta con expires_at y countdown calculado contra tiempo del servidor.

PP-002. El staff puede tardar en responder WhatsApp.
Respuesta: hold absoluto de hasta 24 horas, limitado por registration_close_at.

PP-003. El participante abandona el proceso.
Respuesta: cancelación manual por buyer o expiry automático.

PP-004. Los holds pueden aparentar agotamiento.
Respuesta: TEMPORARILY_UNAVAILABLE separado de SOLD_OUT.

PP-005. Dos personas quieren el último lugar.
Respuesta: locks de Edition/Modality, participant claims y transacción atómica.

PP-006. Un doble click puede duplicar operaciones.
Respuesta: idempotency keys, constraints y commands idempotentes.

PP-007. WhatsApp no está conectado al sistema.
Respuesta: public_reference estable que conecta conversación humana con RegistrationRequest.

PP-008. RUNIIS no detecta la transferencia bancaria.
Respuesta: RegistrationConfirmation explícita por staff; no inferencias automáticas.

PP-009. El usuario quiere registrar a varias personas.
Respuesta: Request agrupa participantes; Registration sigue siendo individual.

PP-010. Un Friend ya tiene identidad RUNIIS.
Respuesta: selección por Friendship sin revelar PII ni QR ajeno.

PP-011. Una persona ocasional no quiere cuenta.
Respuesta: GuestParticipant sin comunidad ni créditos.

PP-012. Un Guest no debe quedar como perfil reutilizable indefinido.
Respuesta: ACTIVE -> ARCHIVED después de la ventana definida, sin borrar evidencia.

PP-013. Un menor no debe saltarse el guardian usando Guest.
Respuesta: GuardianAssignment polimórfico y verificación presencial obligatoria.

PP-014. La ausencia de scan no demuestra inasistencia.
Respuesta: AttendanceResolution PENDING y revisión humana antes de Finalization.

PP-015. Una DQ no es lo mismo que ausencia.
Respuesta: SportingEligibilityResolution separado de AttendanceResolution.

PP-016. Los kilómetros no pueden depender de un contador editable.
Respuesta: DistanceCredit ledger vinculado a cierre y asistencia.

PP-017. El ranking puede estar incompleto al cambiar el mes.
Respuesta: estado CONSOLIDATING y Closure Readiness antes de snapshot oficial.

PP-018. Un empate no debe romperse arbitrariamente.
Respuesta: competition ranking y achievements para todos los ocupantes del puesto.

PP-019. El usuario necesita volver a abrir su QR.
Respuesta: token aleatorio cifrado recuperable + hash de validación + credential versioning.

PP-020. Un QR filtrado debe poder invalidarse sin perder historia.
Respuesta: reemplazo de ParticipantPassCredential, no segundo ParticipantPass.

PP-021. Un avatar pendiente no debe eliminar uno ya aprobado.
Respuesta: publicación atómica al aprobar la nueva imagen.

PP-022. Una imagen inapropiada puede superar revisión humana.
Respuesta: REMOVE, invalidación pública y suspensión de upload tres meses.

PP-023. Supabase no debe cargar todo el tráfico de media.
Respuesta: object storage separado para assets.

PP-024. Un equipo pequeño no puede mantener workflows manuales innecesariamente complejos.
Respuesta: colas operativas, bulk actions explícitas, defaults globales y Task Center derivado.

PP-025. Una campaña puede consumir cuota necesaria para emails críticos.
Respuesta: prioridad y reserva de capacidad P0/P1 frente a P3.

PP-026. Un proveedor externo puede fallar después de un COMMIT.
Respuesta: outbox durable, retries, reconciliation y dependencia desacoplada.

PP-027. Un worker puede morir mientras procesa.
Respuesta: lease con expiración, reclaim, idempotencia y escalamiento.

PP-028. Un ban debe aplicarse aunque la persona tenga sesión activa o la agregue otro buyer.
Respuesta: elegibilidad server-side y efectos transversales del PLATFORM_BAN.

PP-029. Un cambio de ruta no debe alterar los kilómetros oficiales accidentalmente.
Respuesta: computed_distance_m separado de official_distance_m.

PP-030. Un evento puede tener fecha pero no hora confirmada.
Respuesta: EditionScheduleRevision permite DATE_CONFIRMED_TIME_PENDING sin inventar tiempo.

228. SUPERFICIES ADMINISTRATIVAS Y COMPONENTES FUNCIONALES

Dashboard:

Debe resumir salud operativa sin convertirse en fuente de verdad. Debe mostrar próximas Editions, solicitudes pendientes, ocupación, asistencia pendiente, Task blockers, estado de comunicaciones e incidencias críticas.

Task Center:

Debe priorizar acción. Filtros por prioridad, blocking_level, Edition, categoría, estado y assignee. Resolver una Task derivada no puede mutar falsamente la entidad origen.

Edition Admin:

Debe agrupar configuración, schedule, modalidades, categorías, formularios, precios, capacidades, WhatsApp, contenido, lugares, agenda, rutas y publicación. Publication Readiness y Registration Readiness deben mostrarse como validaciones explícitas.

Registration Requests:

Tabla con reference, buyer, participantes, modalidades, importe snapshot, created_at, expires_at, status y acciones. Debe distinguir expiración temporal de status materializado.

Participants:

Tabla con registration_number, nombre, PROFILE/GUEST, buyer, modality, category, email/contacto cuando el rol lo permita, pass status, kit, check-in, final attendance, sporting eligibility, credits e incidencias. Búsqueda, filtros y export CSV con permiso específico.

Kit Center:

Debe mostrar inventario por variante, allocations, entregados, pendientes y exceptions. Scan duplicado no entrega dos veces.

Race Day Scanner:

Debe fijar Edition/station/operation. Feedback inmediato y inequívoco. Debe ofrecer manual lookup controlado. No depender únicamente de color.

Attendance Workspace:

Debe mostrar universo esperado, PRESENT, PENDING, NO_SHOW, EXCLUDED y SportingEligibility. Debe permitir acciones individuales y bulk controladas. Finalize deshabilitado mientras existan blockers.

Community Admin:

Debe incluir avatar moderation queue, integrity cases, rankings en consolidación, snapshots y achievement reconciliation cuando exista corrección.

User/Sanction Admin:

Debe permitir búsqueda autorizada de cuenta, identity lock/unlock, correction de nombre, avatar suspension, ban/unban y AuditLog relacionado.

Communications Admin:

Debe mostrar mensajes, failures, suppressions, quota, campaigns, preview, audience estimate y estado de dispatch.

Componentes funcionales base que deben existir o tener equivalente semántico:

Button
IconButton
TextField
Select
Checkbox
Radio
DateInput
SearchInput
FormField/Error
StatusBadge
Alert/Callout
EventCard
FilterBar/FilterDrawer
Tabs
Stepper
Modal
Drawer
Toast
DataTable
Pagination/CursorControls
EmptyState
Skeleton
Avatar
ProfileHeader
FriendAction
RegistrationParticipantCard
CountdownStatus
ParticipantPassView
QRCodeView
ScannerFeedback
KitStatus
AttendanceStatus
RankingRow
Podium
AchievementBadge
AdminTaskItem
RouteMap
RouteEditorToolbar
FileUpload/GPXImport
PublicationReadinessPanel
QuotaStatus

Estados mínimos de componentes interactivos:

default
hover
focus-visible
active
loading
disabled
error
success cuando proceda.

No crear estilos ad hoc incompatibles con los tokens de Foundations.

229. ROUTING DE QR Y EMAIL EN REGISTRO MÚLTIPLE

Caso buyer Lehi registra:

- Lehi como PROFILE;
- Luz como Friend PROFILE;
- Carlos como Friend PROFILE;
- Pedro como GUEST.

Después de confirmación se crean cuatro Registration, cuatro ParticipantPass y cuatro credentials.

Entrega:

Lehi recibe su propio pase.
Luz recibe su propio pase en su contacto verificado.
Carlos recibe su propio pase en su contacto verificado.
Pedro no tiene cuenta; su pase se entrega al buyer Lehi.

El buyer puede recibir un summary de toda la solicitud, pero el summary no debe incorporar los QR secretos de Friends con cuenta.

Si el email falla:

- Registration sigue confirmada;
- pass sigue disponible en cuenta correspondiente;
- CommunicationMessage queda para retry/support.

230. ANTI-PATTERNS

Prohibido:

- reintroducir Payment V1;
- usar WhatsApp API V1;
- llamar pago confirmado a un chat;
- over-selling;
- guardar available_slots manualmente;
- tratar holds vencidos como vigentes;
- depender del worker para expiry efectivo;
- guardar QR plaintext sin cifrado en DB/log;
- crear segundo ParticipantPass al reemplazar QR;
- usar computed route distance como official_distance;
- publicar GPX automáticamente;
- inventar hora;
- mezclar Guest con RunnerProfile;
- dar credits a Guest;
- meter menores en ranking público V1;
- editar total km manualmente;
- cerrar ranking solo por fecha;
- dar achievement desde ranking provisional;
- borrar snapshots/revisions;
- cerrar blocker task sin corregir fuente;
- marketing sin consent;
- emergency contact como marketing lead;
- roles en metadata editable;
- service secret en browser;
- hidden UI como autorización;
- hard-delete AuditLog;
- hard-delete DistanceCredit para corregir;
- convertir Friends en red social;
- diseñar V2 en profundidad.

231. CRITERIO FINAL

RUNIIS debe presentar una experiencia externa sencilla:

usuario descubre -> elige -> se identifica -> selecciona personas -> aparta -> coordina pago externo si aplica -> recibe confirmación -> recibe pase -> participa -> acumula historia verificable.

staff configura -> publica -> administra solicitudes -> confirma -> entrega -> registra -> resuelve asistencia -> cierra -> revisa comunidad.

Internamente esa sencillez se apoya en estados explícitos, transacciones, capacidad derivada, revisiones históricas, RLS, RBAC, idempotencia, outbox, auditoría, workers recuperables, snapshots y pruebas.

FIN DE RUNIIS WEB — SYSTEM MASTER SPECIFICATION V2
