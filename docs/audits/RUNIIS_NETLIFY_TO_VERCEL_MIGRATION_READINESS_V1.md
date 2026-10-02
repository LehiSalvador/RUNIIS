# RUNIIS — Netlify → Vercel Migration Readiness V1

| Campo | Valor |
| --- | --- |
| Fecha | 2026-10-01 America/Monterrey (2026-10-02 UTC) |
| Ejecutor | Claude principal; inspección read-only (APIs Vercel/Netlify vía CLIs autenticados, DNS público, HTTP público, código) |
| Mutaciones | Ninguna en Netlify, Vercel, DNS, Supabase, Brevo, Cloudinary, PostHog, Sentry, Google |
| Estado de readiness | `NOT_READY_FOR_CUTOVER` — `READY_TO_PREPARE` (preparación hasta Preview posible sin costo) |
| Findings referenciados | `RUNIIS_MASTER_AUDIT_REPORT_V1.md` §8 |

## 1. Decisión del owner

- DECISION (CLOSED, 2026-10-01): `TARGET_PRODUCTION_HOSTING = VERCEL`.
- Netlify = `CURRENT_LEGACY_HOSTING_PENDING_MIGRATION`; permanece operativo hasta una fase posterior que complete y valide la migración.
- Sin autorización para billing, upgrades, trials con tarjeta ni add-ons. Sin autorización para ejecutar la migración en esta fase.
- Esta auditoría no reabre la decisión. Identifica una condición de cumplimiento (plan Vercel vs uso comercial) que el owner debe resolver antes del cutover productivo (OWN-01).

## 2. Resumen de readiness

| Dimensión | Estado | Clave |
| --- | --- | --- |
| Compatibilidad Next.js | READY | Next 16.3.6 + React 19.3 + App Router + `proxy.ts` (Node) construyen en Vercel (build de `main` READY con pnpm 11.8.0) |
| Código dependiente de Netlify | 3 cambios obligatorios | IP cliente (AUD-004), disparo de workers (AUD-002), límite GPX (AUD-015) |
| Proyecto Vercel existente | Presente, mal configurado para V1 | Env incompleto/compartido (AUD-005), dominio apex→www invertido (AUD-010), auto-deploy activo (AUD-021) |
| DNS | Favorable | Zona ya en Vercel DNS, TTL 60, certificado wildcard emitido |
| Workers | Bloqueado en Hobby | Cron Hobby diario; alternativa gratuita: Supabase `pg_cron` + `pg_net` |
| Plan / términos | OWNER_DECISION | Hobby = no comercial (AUD-001) |
| Providers | Mayormente host-independientes | Supabase redirect allowlist (AUD-023); Brevo IP blocking (AUD-006, afecta a cualquier host) |
| Riesgo de estado | Muy bajo hoy | Producción sirve un placeholder sin usuarios ni datos V1 |

INFERENCE clave para el roadmap: como ningún host ejecuta V1 y producción solo sirve el placeholder, el cutover de dominio puede hacerse antes del lanzamiento de V1, cuando el estado afectado es nulo. El primer despliegue productivo de V1 ocurriría entonces directamente sobre Vercel.

## 3. Topología Netlify actual (CURRENT_REALITY)

| Elemento | Valor (FACT) |
| --- | --- |
| Sitio | `runiis-web`, id `129537db-751a-4828-9651-3cd93fef4c37`, cuenta `runiis-platform` (Free), usuario CLI `runiis.platform@gmail.com` |
| Repo / ramas | `LehiSalvador/RUNIIS`, production branch `main`, allowed branches `main`, `staging` |
| Build | `netlify.toml`: `pnpm run build`, publish `.next`, plugin `@netlify/plugin-nextjs` (devDep 5.16.0); UI del sitio: `npm run build` (sobrescrito por toml) |
| Runtime | Node 24, imagen `noble`, functions `us-east-2` |
| Producción publicada | `main@bdd1198`, deploy `6ab8becd3b22e30008c80c96` (2026-09-27), placeholder |
| Staging | Branch deploy `staging@89b79d4` en `staging--runiis-web.netlify.app`, placeholder |
| Dominio | `runiismty.com` custom domain, `force_ssl`, `www` → apex 301; `managed_dns: true` sin uso (nameservers Vercel) |
| Funciones | Ninguna desplegada en producción; código V1 trae 4 Scheduled Functions (no publicadas) |
| Deploy hook | Presente (consumidor UNKNOWN) |
| Env vars | 26 (ver §8) |
| HSTS observado | `max-age=31536000` (Netlify, custom domain) |
| Inyección | `/.netlify/scripts/hud` en HTML público (feature de Netlify) |

## 4. Topología Vercel objetivo (TARGET_ARCHITECTURE, propuesta)

| Entorno | Fuente | Dominio | Datos | Email | Plan requerido |
| --- | --- | --- | --- | --- | --- |
| Production | `main` | `runiismty.com` primario; `www` → apex 308 | Supabase `mdzhsoeqagtwznybwtuy` | `EMAIL_DELIVERY_MODE=live` | Comercial → OWN-01 |
| Preview `staging` | rama `staging` | `staging.runiismty.com` asignado a la rama (branch domain) | Supabase no productivo (OPEN-02) | `allowlist` + `EMAIL_ALLOWLIST` | Hobby suficiente |
| Preview genérico (PR/otras ramas) | cualquier otra rama | URLs generadas, protegidas por Vercel Authentication | Sin secretos productivos; valores no productivos o mínimos | `capture` | Hobby suficiente |
| Local | máquina del owner | `127.0.0.1:3100` | Supabase Docker local | `capture` + Mailpit | — |

Fundamento documental (vercel.com/docs/deployments/environments, last_updated 2026-09-17): "Preview branch for staging … All plans, including Hobby" (dominio asignado a rama + variables Preview por rama); "Custom environments … Pro and Enterprise" (1 por proyecto en Pro). Conclusión: la rama `staging` debe ser Vercel Preview con branch domain y variables Preview específicas de rama; no requiere Custom Environment ni plan de pago.

Mapeo SalvaOps: el binding Vercel declara entornos `development`, `production`, `staging`; `staging` debe mapearse a Preview + rama `staging` (Hobby no tiene custom environment).

## 5. Inventario de dependencias Netlify

| Elemento | Uso actual | Clasificación | Acción futura |
| --- | --- | --- | --- |
| `netlify.toml` | build + plugin | REMOVE_AFTER_MIGRATION | Vercel detecta Next.js (framework `nextjs` ya configurado) |
| `@netlify/plugin-nextjs` 5.16.0 | Adaptador OpenNext/Netlify | REMOVE_AFTER_MIGRATION | Vercel nativo |
| `@netlify/functions` 6.0.0 | Tipos `Config` de Scheduled Functions | REMOVE_AFTER_MIGRATION | Sustituir disparo (§17) |
| `netlify/functions/cron-outbox-dispatch.ts` (`* * * * *`) | Dispara `POST /api/internal/workers/outbox-dispatch` | CODE_CHANGE_REQUIRED / BLOCKER en Hobby | §17 |
| `netlify/functions/issue-pending-credentials.ts` (`*/5`) | Red de seguridad de emisión QR | CODE_CHANGE_REQUIRED | §17 |
| `netlify/functions/cron-communication-reconcile.ts` (`*/15`) | Triggers T-7/T-24, campañas, escalado | CODE_CHANGE_REQUIRED / BLOCKER en Hobby | §17 |
| `netlify/functions/cron-provider-usage-reconcile.ts` (`5 0 * * *`) | Snapshot diario de cuota | VERCEL_NATIVE_EQUIVALENT (cron diario Hobby, precisión ±59 min) o §17 | — |
| Edge Functions | No usadas en código fuente (`.netlify/edge-functions` local es artefacto del adaptador) | NOT_USED | — |
| Background Functions | No usadas | NOT_USED | — |
| Forms | No usadas | NOT_USED | — |
| Identity | No usada (Supabase Auth) | NOT_USED | — |
| Blobs | Implícito: cache ISR del adaptador | VERCEL_NATIVE_EQUIVALENT | ISR/Data Cache nativos de Vercel |
| Redirects / rewrites | Ninguno en `netlify.toml`; `www`→apex en la configuración de dominio Netlify | CONFIG_CHANGE_REQUIRED | Configurar en dominios Vercel (AUD-010) |
| Headers | En `next.config.ts` (HSTS, nosniff, Referrer, XFO, `frame-ancestors`, Permissions-Policy, `X-Robots-Tag` design-system) y en `proxy.ts` (CSP) | PORTABLE_AS_IS | Verificar en Preview |
| Header `x-nf-client-connection-ip` | IP cliente para rate limit anónimo | CODE_CHANGE_REQUIRED / BLOCKER | Usar `x-real-ip` / `x-vercel-forwarded-for` (Vercel documenta sobrescritura anti-spoofing) con tests (AUD-004) |
| Env vars Netlify | 26 claves en contextos production / branch=staging / branch-deploy | CONFIG_CHANGE_REQUIRED | §8 |
| `SECRETS_SCAN_OMIT_KEYS` | Excepción del secret scanning de Netlify | REMOVE_AFTER_MIGRATION | — |
| Deploy hook | Existe | REMOVE_AFTER_MIGRATION / UNKNOWN consumidor | Inventariar antes de retirar |
| Branch deploys | `staging` | VERCEL_NATIVE_EQUIVALENT | Preview + branch domain |
| Dominio Netlify (`runiismty.com`) | Primario | REMOVE_AFTER_CUTOVER (tras ventana de rollback) | — |
| Netlify DNS zone (`managed_dns`) | Sin efecto | REMOVE_AFTER_MIGRATION | — |
| Analytics / logs Netlify | No configurados | NOT_USED | — |
| Plugins adicionales | Ninguno | NOT_USED | — |
| Runtime: timeout de función 25 s en triggers, scheduled 30 s | Límite de diseño de triggers | PORTABLE_AS_IS | Vercel Hobby: 300 s |

## 6. Auditoría del proyecto Vercel existente

| Atributo | Valor (FACT, `vercel api` read-only) |
| --- | --- |
| Proyecto | `runiis-web`, `prj_8cMyzcQpzyJUd286AQ5DmpN2fHZE`, creado 2026-09-27T06:17Z |
| Team | `lehisalvadors-projects` (`team_HyzbsOaKDet7pos4oNDbVI8g`), plan `hobby`, billing Stripe sin trial; el team aloja otros proyectos del owner |
| Git | GitHub `LehiSalvador/RUNIIS`, production branch `main`, `createDeployments: enabled`, comments en PR activos, fork protection activa, sin deploy hooks |
| Framework / build | `nextjs`; build/install/output por defecto; Node `24.x`; build machine `basic` |
| Compute | Fluid compute, región `iad1` (misma zona general que Supabase `us-east-1`) |
| Deployments | 4, todos production desde `main` (`43dcc4d`, `7d1980b`, `0463887`, `bdd1198`), READY; ninguno Preview |
| Build log (`dpl_8Bzv94…`) | Detecta pnpm 11.8.0 vía `packageManager`, Next 16.3.6, build OK en ~10 s |
| URL técnica | `runiis-web.vercel.app` → 200, placeholder; health `staging` |
| Dominios | `runiismty.com` (redirect 308 → `www.runiismty.com`), `www.runiismty.com`, `runiis-web.vercel.app`; asignados 2026-09-27T07:21Z; verificados |
| Certificado | `*.runiismty.com` + `runiismty.com`, emitido 2026-09-24, expira 2026-12-23, auto-renew |
| Env vars | 24, tipo `sensitive`, target `production,preview` en una sola entrada cada una, sin rama ni development; creadas en el mismo minuto que el proyecto; valores ilegibles por diseño (procedencia UNKNOWN) |
| Crons | Habilitados sin definiciones |
| Protección | Vercel Authentication `all_except_custom_domains`; sin password protection ni bypass |
| OIDC | Habilitado (issuer team) |
| Retención | Deployments 30 días, conservar 10 |
| SalvaOps binding | CONNECTED, health NOT_CONFIGURED; capacidades `vercel.*` UNAVAILABLE con Desktop cerrado |

Drift respecto de la documentación: `docs/RUNIIS_INFRA_SETUP_REPORT.md` afirma que el proyecto no tiene `runiismty.com` asignado y que no recibió secretos; ambos puntos no coinciden con la API (AUD-037). Drift de configuración: redirect apex→www inverso al canónico (AUD-010).

## 7. Compatibilidad y readiness de Next.js en Vercel

| Aspecto | Estado en código | Vercel |
| --- | --- | --- |
| Next.js / React | 16.3.6 / 19.3.0, App Router, Turbopack build | Soportado (build verificado en `main`) |
| Package manager | pnpm 11.8.0 (`packageManager`), lockfile v9, `pnpm-workspace.yaml` con `allowBuilds` | Funciona (log de build); tabla oficial lista pnpm 6–10 → mantener `packageManager` |
| Server / Client Components | Server por defecto; client en formularios y mapa | Nativo |
| Route Handlers | 131 (`route.ts`/`route.tsx`), 123 en `/api/v1`; 2 con `runtime = "nodejs"`, resto por defecto Node | Nativo (Fluid compute) |
| Server Actions | No usadas | — |
| `proxy.ts` (antes middleware) | Refresco de sesión Supabase + CSP nonce/pública; llama `getServerEnv()` en cada request | Nativo en Node; exige env completo (AUD-005) |
| Edge runtime | No usado | — |
| Static / ISR | `/` revalidate 60; `/eventos/[slug]` ISR on-demand (`generateStaticParams` vacío, `dynamicParams`), legal y sitemap 300 s; `unstable_cache` con tags + `revalidateTag` | Nativo; verificar invalidación por tags en Preview |
| Dinámico | `/eventos`, `/cuenta/*`, `/entrar`, `/onboarding`, APIs | Nativo |
| Imágenes | `next/image` con loader Cloudinary propio; `remotePatterns` res.cloudinary.com | No consume Image Optimization de Vercel |
| OG images | `ImageResponse` en `/og` y `/og/eventos/[slug]` | Nativo |
| Streaming / `loading.tsx` | Usado en `/cuenta/*` | Nativo (ver AUD-033) |
| Uploads | GPX en JSON base64 hasta 7.5 MB; avatar previsto como signed upload directo a Cloudinary | GPX excede 4.5 MB de body (AUD-015) |
| Background / `after()` | No usado; no hay "kick" post-commit de workers | Workers dependen 100 % del scheduler |
| Duración | Workers acotados por triggers de 25 s | Hobby: 300 s por defecto y máximo |
| Build-time data | Prerender de `/legal/*` y sitemap consulta Supabase durante el build; falla de forma tolerante | Requiere env de Supabase en build (Vercel inyecta env también en build) |
| `APP_BASE_URL` en build | `metadataBase`, sitemap, robots, canonical | Debe existir por entorno y en build |
| Variables de sistema Vercel | `autoExposeSystemEnvs: true`; el código no las usa | Opcional (`VERCEL_ENV`, `VERCEL_URL`) |
| Dev-only | `allowedDevOrigins`, `'unsafe-eval'` solo en development | Sin efecto en Vercel |

Comportamientos que hoy dependen de Netlify: header de IP cliente, Scheduled Functions, cache ISR vía Netlify Blobs (transparente), redirect `www`→apex en dominio Netlify, HSTS que Netlify añade por su cuenta. La paridad no es automática en esos cinco puntos.

## 8. Environment parity

Estados: PRESENT, MISSING, NOT_REQUIRED, UNKNOWN. Ningún valor fue leído ni registrado. "Netlify staging" = contexto `branch=staging` o, para variables Brevo, contexto `branch-deploy`.

| Variable | Netlify Prod | Netlify staging | Vercel Prod | Vercel Preview | Vercel Dev | Uso en código | Scope objetivo | Acción de migración |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `APP_ENV` | PRESENT | PRESENT | MISSING | MISSING | MISSING | Obligatoria (zod) | Prod=`production`; Preview staging=`staging` | Crear por entorno |
| `APP_BASE_URL` | PRESENT | PRESENT | PRESENT | PRESENT (misma entrada) | MISSING | Obligatoria; build y runtime | Prod apex; Preview staging branch domain | Separar valores |
| `NEXT_PUBLIC_SUPABASE_URL` | PRESENT | PRESENT | PRESENT | PRESENT (misma entrada) | MISSING | Obligatoria | Prod vs no productivo | Separar; verificar procedencia |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | PRESENT | PRESENT | PRESENT | PRESENT (misma entrada) | MISSING | Obligatoria | Igual | Separar |
| `SUPABASE_SECRET_KEY` | PRESENT | PRESENT | PRESENT | PRESENT (misma entrada) | MISSING | Obligatoria, server-only | Nunca prod en Preview | Separar (Master §195) |
| `PASS_CREDENTIAL_ENCRYPTION_KEY_V1` | PRESENT | PRESENT | PRESENT | PRESENT (misma entrada) | MISSING | Obligatoria | Clave prod idéntica a la usada por la DB prod; distinta en Preview | Copiar valor prod exacto (si se cambia, los QR existentes no se descifran) |
| `INTERNAL_CRON_SECRET` | PRESENT | PRESENT | PRESENT | PRESENT (misma entrada) | MISSING | Obligatoria | Por entorno | Separar; replicar en el scheduler elegido |
| `EMAIL_DELIVERY_MODE` | MISSING | MISSING | MISSING | MISSING | MISSING | Opcional; en producción sin valor = rechazar envíos | Prod `live`; staging `allowlist`; resto `capture` | Crear |
| `EMAIL_ALLOWLIST` | MISSING | MISSING | MISSING | MISSING | MISSING | Requerida con `allowlist` | Preview staging | Crear |
| `BREVO_API_KEY` | PRESENT | PRESENT | PRESENT | PRESENT (misma entrada) | MISSING | Envío real | Prod; staging solo si `allowlist` | Separar |
| `BREVO_WEBHOOK_AUTH_SECRET` | PRESENT | PRESENT | PRESENT | PRESENT (misma entrada) | MISSING | Webhook (mín. 32) | Prod y staging distintos | Separar |
| `BREVO_SENDER_EMAIL` / `BREVO_SENDER_NAME` | PRESENT | PRESENT | PRESENT | PRESENT | MISSING | Envío | Prod/Preview | Mantener |
| `BREVO_SMTP_LOGIN` / `BREVO_SMTP_KEY` | PRESENT | PRESENT | PRESENT | PRESENT | MISSING | No (SMTP lo usa Supabase Auth) | NOT_REQUIRED en hosting | No migrar (AUD-029) |
| `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` | PRESENT | PRESENT | PRESENT | PRESENT | MISSING | CSP, loader, `remotePatterns` (también en build) | Prod/Preview | Mantener |
| `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | PRESENT | PRESENT | PRESENT | PRESENT | MISSING | Aún no (upload pendiente) | Server-only, por entorno | Mantener para la fase de avatar |
| `NEXT_PUBLIC_POSTHOG_KEY` / `NEXT_PUBLIC_POSTHOG_HOST` | PRESENT | PRESENT | PRESENT | PRESENT | MISSING | Aún no | Por entorno | Mantener |
| `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT` | PRESENT | PRESENT | PRESENT | PRESENT | MISSING | Aún no | Por entorno | Mantener |
| `SENTRY_AUTH_TOKEN` | MISSING | MISSING | PRESENT | PRESENT | MISSING | Aún no (sourcemaps) | Build only | Revisar procedencia |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | PRESENT | MISSING | PRESENT | PRESENT | MISSING | No (OAuth configurado en Supabase) | NOT_REQUIRED | Eliminar de Vercel en fase posterior |
| `DEFAULT_WHATSAPP_PHONE_E164` | MISSING | MISSING | PRESENT | PRESENT | MISSING | No (DB `platform_settings`) | NOT_REQUIRED | Eliminar o documentar |
| `SUPABASE_PROJECT_REF` | PRESENT | PRESENT | MISSING | MISSING | MISSING | No | NOT_REQUIRED | No migrar |
| `DATABASE_URL` | MISSING | PRESENT | MISSING | MISSING | MISSING | No | NOT_REQUIRED | No migrar |
| `SECRETS_SCAN_OMIT_KEYS` | PRESENT (all) | PRESENT | MISSING | MISSING | MISSING | Netlify-only | NOT_REQUIRED | Retirar con Netlify |
| `NEXT_PUBLIC_MAP_STYLE_URL` | MISSING | MISSING | MISSING | MISSING | MISSING | Opcional (default OpenFreeMap) | Opcional | Ninguna |
| `MAILPIT_URL` | MISSING | MISSING | MISSING | MISSING | MISSING | Solo local | NOT_REQUIRED | Ninguna |
| `CRON_SECRET` | MISSING | MISSING | MISSING | MISSING | MISSING | No | Solo si se adopta Vercel Cron | Decidir con OPEN-01 |

Riesgo transversal: las 24 entradas Vercel comparten Production y Preview. Si contienen valores productivos, cualquier push a una rama no-`main` desplegaría Preview con secretos de producción (Master §195). Procedencia UNKNOWN; se corrige separando entradas antes de habilitar Previews V1.

## 9. Estrategia Preview / staging

1. Rama `staging` → Vercel Preview con dominio `staging.runiismty.com` asignado a la rama (Hobby). El DNS ya resuelve el wildcard a Vercel.
2. Variables Preview específicas de rama `staging` para: `APP_ENV=staging`, `APP_BASE_URL=https://staging.runiismty.com`, Supabase no productivo, `PASS_CREDENTIAL_ENCRYPTION_KEY_V1` propia, `INTERNAL_CRON_SECRET` propio, `EMAIL_DELIVERY_MODE=allowlist` + `EMAIL_ALLOWLIST`, `BREVO_WEBHOOK_AUTH_SECRET` propio.
3. Variables Preview genéricas (otras ramas/PR): valores no productivos y `EMAIL_DELIVERY_MODE=capture`; deployments protegidos por Vercel Authentication.
4. Backend de datos de Preview: OPEN-02. Opciones: Supabase remoto staging `brxdgvcfykmsqmhsvgxl` (hoy no autoritativo, requiere aplicar migraciones V1) o Preview solo UI/smoke sin escrituras. El modelo owner prohíbe usar producción.
5. Indexación: `staging.runiismty.com` es dominio custom (exento de Vercel Authentication con la configuración actual) y `app/robots.ts` no varía por entorno. Riesgo de indexación de staging (UNVERIFIED si Vercel añade `noindex` a dominios custom de Preview); conviene `robots` dependiente de `APP_ENV` o protección.
6. Alternativa de verificación con configuración productiva sin dominios: "staged production deployment" (desactivar auto-assign de dominios productivos y promover manualmente), disponible en todos los planes según la documentación.

## 10. Mapa de dominio y DNS

Zona en Vercel DNS (nameservers `ns1/ns2.vercel-dns.com`). Registros observados vía API y resolución pública (8.8.8.8 y `ns1.vercel-dns.com`).

| Registro | Valor | Creador | Resolución actual | Clasificación |
| --- | --- | --- | --- | --- |
| `@ A` | `75.2.60.5` (Netlify) | owner, 2026-09-26 | Prevalece: apex → Netlify | CHANGE_FOR_VERCEL (eliminar en cutover; conservar valor para rollback) |
| `@ ALIAS` | `84d9b449bb5bfe43.vercel-dns-017.com` | system, 2026-09-27 | Inactivo mientras exista el `A` manual | PRESERVE (toma el apex al eliminar el `A`) — REQUIRES_VERIFICATION de precedencia en el momento del cambio |
| `www CNAME` | `runiis-web.netlify.app.` | owner, 2026-09-26 | `www` → Netlify | CHANGE_FOR_VERCEL |
| `* ALIAS` | `cname.vercel-dns-017.com.` | system, 2026-09-27 | Subdominios → Vercel (`staging.runiismty.com` 404) | PRESERVE (habilita branch domain) |
| `@ TXT` | `brevo-code:…` | owner, 2026-09-26 | Verificación Brevo | PRESERVE |
| `brevo1._domainkey CNAME`, `brevo2._domainkey CNAME` | DKIM Brevo | owner | Activos | PRESERVE |
| `_dmarc TXT` | `v=DMARC1; p=none; rua=mailto:rua@dmarc.brevo.com` | owner | Activo | PRESERVE (endurecer en el futuro) |
| `@ CAA` ×3 | `letsencrypt.org`, `sectigo.com`, `pki.goog` | system | Activos | PRESERVE (cubren Let's Encrypt de Netlify y Vercel) |
| SPF / MX | Ausentes | — | — | REQUIRES_VERIFICATION (no requerido por Brevo según su modelo de autenticación; no re-verificado) |
| Registro del dominio | Vercel, expira 2027-09-24, `renew: false` | — | — | OWNER_DECISION (AUD-011) |

Registros que apuntan hoy a Netlify: `@ A 75.2.60.5` y `www CNAME runiis-web.netlify.app`. Ninguno más.

Configuración de dominio en el proyecto Vercel a corregir antes del cutover: invertir `runiismty.com → www` a `www → runiismty.com` (AUD-010).

## 11. Impacto en OAuth y URLs absolutas

| Superficie | Dependencia de host | Impacto del cambio de hosting | Clasificación |
| --- | --- | --- | --- |
| Google OAuth (Google Cloud) | Callback = `https://<ref>.supabase.co/auth/v1/callback` | Ninguno (dominio Supabase) | PRESERVE |
| Supabase Site URL / redirect allowlist (prod) | `https://runiismty.com/auth/callback` | Ninguno si el dominio se mantiene | PRESERVE / REQUIRES_VERIFICATION remota |
| Supabase redirect allowlist (staging/preview) | URLs Netlify staging | Añadir `https://staging.runiismty.com/**` y, si se usan URLs generadas, `https://*-lehisalvadors-projects.vercel.app/**` (patrón recomendado por Supabase) | CHANGE_FOR_VERCEL |
| `/auth/callback` | Usa `request.nextUrl.origin` | Portable | PRESERVE |
| `/api/v1/auth/google` | Construye redirect desde `APP_BASE_URL` | Requiere `APP_BASE_URL` correcto por entorno | CHANGE_FOR_VERCEL (env) |
| Same-origin check de mutaciones (`lib/server/http/handler.ts`) | `request.nextUrl.origin` + `APP_BASE_URL` | Portable con env correcto | PRESERVE |
| CSP `report-uri`/`Reporting-Endpoints` | `APP_BASE_URL` | Portable | PRESERVE |
| Canonical, OpenGraph, `metadataBase`, sitemap, robots | `APP_BASE_URL` (fallback `http://localhost:3100` si falta en build) | Requiere env en build | CHANGE_FOR_VERCEL (env) |
| Links en emails, pases y QR | `APP_BASE_URL` validado same-origin en `render.ts` | Portable | PRESERVE |
| Webhook Brevo | `https://runiismty.com/api/webhooks/brevo` (aún no registrado) | Ninguno si el dominio se mantiene | PRESERVE (registrar en fase de providers) |
| Cookies de sesión | Host-only en `runiismty.com`, `Secure` según `APP_BASE_URL` | Las sesiones sobreviven al cutover (mismo dominio, mismo proyecto Supabase) | PRESERVE |
| CORS / allowed origins | No hay CORS abierto (APIs same-origin) | — | NOT_USED |
| Admin URLs, QR links | Relativos al dominio | — | PRESERVE |
| PostHog / Sentry allowed domains | Sin SDK aún | Configurar al integrar | UNKNOWN |
| Cloudinary | `res.cloudinary.com/<cloud>` | Independiente | PRESERVE |

## 12. Impacto Supabase

- La DB no migra. El cambio de hosting no altera esquema, RLS ni datos.
- Server keys: `SUPABASE_SECRET_KEY` solo en entornos server Vercel; browser solo recibe `NEXT_PUBLIC_*` (ADR-001 A8: no hay cliente Supabase en browser).
- Auth: Site URL y allowlist productivas no cambian; añadir orígenes de Preview (§11). Estado remoto actual UNKNOWN (AUD-019).
- Edge Functions de Supabase: ninguna en el repositorio (`supabase/functions` no existe); no hay llamadas DB → web salvo la propuesta de scheduler (§17).
- `pg_cron`: los 3 workers DB son independientes del hosting.
- Email links de Auth (OTP): JSON API propia; la plantilla OTP no depende del host.
- Región: Supabase `us-east-1` y Vercel `iad1` próximos; Netlify functions `us-east-2`.

## 13. Impacto Brevo

| Elemento | Estado | Impacto |
| --- | --- | --- |
| Env runtime | `BREVO_API_KEY`, `BREVO_WEBHOOK_AUTH_SECRET`, `BREVO_SENDER_*` | Migrar por entorno (§8) |
| `EMAIL_DELIVERY_MODE` / `EMAIL_ALLOWLIST` | Ausentes en ambos hosts | Sin ellas, producción rechaza envíos (fail-safe A9) |
| Dominio remitente y DNS | Autenticado (brevo-code, DKIM, DMARC) | Independiente del hosting |
| Webhook | No registrado; header estático como único factor (mín. 32 chars) | URL estable con el dominio |
| IPs autorizadas | Brevo bloquea IPs desconocidas tras 30 días sin IPs nuevas (ayuda oficial) | Afecta a Netlify, Vercel y Supabase SMTP por igual (AUD-006); verificar antes de cualquier operación real |
| Cuota | Free 300/día (dato 2026-09-28) | Independiente del hosting (AUD-022) |
| Campañas | No ejecutar envíos reales en migración | — |

## 14. Impacto Cloudinary

- Uso actual: solo URLs de lectura y loader `next/image` propio; `img-src` CSP y `remotePatterns` limitados a `res.cloudinary.com/<cloud>`.
- Upload firmado server-side: no implementado (fase de avatar). Cuando exista, la firma se genera en funciones Vercel; el upload va directo navegador → Cloudinary y exigirá `connect-src` hacia el endpoint de upload.
- Callbacks/notification URLs: ninguno.
- Sin dependencia de host; sin migración de assets. Límites del plan free de Cloudinary: no re-verificados en esta auditoría (UNVERIFIED).

## 15. Impacto PostHog

- No integrado en código. Proyecto existente (smoke de infra). Sin integración Netlify.
- Trabajo futuro (independiente del host): SDK sin autocapture/replay, etiqueta de entorno, sin PII (ADR-001 A9). Límites del plan gratuito no re-verificados (UNVERIFIED).

## 16. Impacto Sentry

- No integrado en código. Proyecto `runiis-web` existente (smoke). Sin integración Netlify.
- En Vercel Hobby los runtime logs se retienen 1 h y no hay log drains (Pro); Sentry pasa a ser la vía principal de diagnóstico de errores en producción. `SENTRY_AUTH_TOKEN` solo para sourcemaps en build. Límites del plan gratuito no re-verificados (UNVERIFIED).

## 17. Evaluación de workers y cron

| Worker | Trigger actual | Frecuencia | Runtime | Idempotencia / concurrencia | Auth | Mecanismo actual | Opción Vercel | Viabilidad free | Riesgo |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `outbox-dispatch` | Netlify scheduled | 1 min | Route POST Node | `FOR UPDATE SKIP LOCKED` + lease, backoff+jitter, `dedupe_key` | Bearer `INTERNAL_CRON_SECRET` | Inactivo en remoto | `pg_cron` + `pg_net` POST | FREE_WITH_LIMIT | Alto: sin él no hay emails P0/P1 |
| `issue-pending-credentials` | Netlify scheduled | 5 min | Route POST | Índice parcial de credencial ACTIVE; emisión inline post-commit y lazy en render | Bearer | Inactivo | `pg_cron` + `pg_net` | FREE_WITH_LIMIT | Bajo (red de seguridad) |
| `communication-reconcile` | Netlify scheduled | 15 min | Route POST | Idempotente | Bearer | Inactivo | `pg_cron` + `pg_net` | FREE_WITH_LIMIT | Medio (recordatorios T-7/T-24, campañas) |
| `provider-usage-reconcile` | Netlify scheduled | Diario 00:05 UTC | Route POST | Idempotente | Bearer | Inactivo | Vercel Cron diario (requiere `GET` + `CRON_SECRET`) o `pg_cron` | FREE_OK | Bajo |
| `close-registration-windows` | `pg_cron` | 5 min | SQL | Commands idempotentes | DB | Supabase | Sin cambio | FREE_OK | Bajo |
| `expire-registration-requests` | `pg_cron` | 5 min | SQL | `expires_at` es autoridad | DB | Supabase | Sin cambio | FREE_OK | Bajo |
| `archive-guests` | `pg_cron` | Diario 09:15 UTC | SQL | Idempotente | DB | Supabase | Sin cambio | FREE_OK | Bajo |
| `task-center-reconcile`, `ranking-projection-refresh`, `ranking-period-manager`, `avatar-processing`, `avatar-orphan-cleanup`, `integrity-scan` | — | 10 min / 15 min / evento / diario / hora | — | — | — | NOT_IMPLEMENTED | Diseñar sobre el mismo mecanismo | — | Futuro |

Opciones de disparo para workers HTTP:

| Opción | Frecuencia mínima | Costo | Cambios | Evaluación |
| --- | --- | --- | --- | --- |
| A. Supabase `pg_cron` + `pg_net` → `POST https://<host>/api/internal/workers/<key>` con Bearer guardado en Supabase Vault | Por minuto (o menos) | FREE_WITH_LIMIT (Supabase recomienda ≤8 jobs concurrentes y ≤10 min por job; disponibilidad en plan Free INFERENCE: la migración `001` ya crea `pg_cron` y la DB local trae `pg_net`) | Migración nueva por entorno; secreto en Vault; URL por entorno | Recomendada: conserva el contrato POST existente y unifica scheduling en Supabase |
| B. Vercel Cron | Hobby: 1/día, ±59 min; Pro: 1/min | Sub-diario = PAID_REQUIRED | Handler `GET` + `CRON_SECRET`; `vercel.json`/`vercel.ts` | Solo viable gratis para `provider-usage-reconcile` |
| C. GitHub Actions `schedule` | ~5 min, sin garantía de puntualidad | FREE (repo público) | Workflow + secreto en GitHub | Respaldo, no primario |
| D. Servicio externo de cron | Variable | Fuera de la lista de proveedores | Nuevo proveedor | No recomendado sin decisión |

Durante la convivencia, si Netlify y el nuevo mecanismo disparan a la vez, los leases y `dedupe_key` evitan efectos duplicados; aun así el mecanismo anterior debe desactivarse al activar el nuevo.

## 18. Viabilidad free-tier

Fuentes Vercel consultadas 2026-10-01 (ver §25).

| Capacidad | Clasificación | Detalle |
| --- | --- | --- |
| Hosting Next.js (SSR, ISR, route handlers, proxy) | FREE_WITH_LIMIT técnicamente; uso comercial = PAID_REQUIRED | Hobby: 1 M invocaciones, 4 h Active CPU, 360 GB-h memoria, 100 GB Fast Data Transfer, 1 M CDN requests al mes; "Hobby teams are restricted to non-commercial personal use only" |
| Exceso de límites en Hobby | FREE_WITH_LIMIT | "if you exceed your usage limits on the Hobby plan, you will have to wait until 30 days have passed" — riesgo de indisponibilidad en picos de inscripción |
| Dominio custom + TLS | FREE_OK | Ya emitido |
| Preview por rama + branch domain + env por rama | FREE_OK | Documentado para Hobby |
| Custom Environment `staging` | PAID_REQUIRED | Pro (1 por proyecto) |
| Cron sub-diario | PAID_REQUIRED | Alternativa gratuita: opción A §17 |
| Duración de funciones | FREE_OK | 300 s |
| Request body | FREE_WITH_LIMIT | 4.5 MB en todos los planes (AUD-015) |
| Memoria / región | FREE_WITH_LIMIT | 2 GB / 1 vCPU; una región |
| Runtime logs | FREE_WITH_LIMIT | 1 h; drains PAID_REQUIRED |
| Vercel Authentication en Preview | FREE_OK | Activa |
| Password protection | PAID_REQUIRED | Add-on Pro |
| WAF | FREE_WITH_LIMIT | 3 reglas custom, 3 bloqueos IP |
| Deployments | FREE_WITH_LIMIT | 100/día |
| Image Optimization | NOT_USED | Loader Cloudinary |
| Colaboración de equipo | PAID_REQUIRED | No necesaria para operar |
| ISR reads/writes incluidos | UNKNOWN | No consultado |

## 19. Hallazgos de capacidades de pago

| Capacidad | Impacto en RUNIIS | Alternativa gratuita | Limitación de la alternativa | Fase afectada |
| --- | --- | --- | --- | --- |
| Plan comercial (Pro) | Requisito de términos para operar RUNIIS con pagos solicitados a visitantes | Ninguna dentro de Vercel; confirmación de Vercel Support de no-comercialidad, o mantener otro host | Conflicto con decisión owner o con Master §11 | Cutover productivo (OWN-01) |
| Cron por minuto | Emails P0/P1 y emisión QR | Supabase `pg_cron` + `pg_net` | Recomendación ≤8 jobs concurrentes, ≤10 min; requiere Vault | Migración |
| Custom Environment | Entorno `staging` con nombre propio | Preview + branch domain | Comparte el scope "Preview" con otras ramas (mitigable con variables por rama) | Migración |
| Log drains / retención de logs | Diagnóstico post-incidente | Sentry | Solo errores capturados | Observabilidad |
| Password protection | Proteger staging público | Vercel Authentication sobre URLs generadas o `robots`/`noindex` por entorno | El dominio custom de staging queda exento con la configuración actual | Migración |
| Renovación de dominio | Continuidad | Ninguna | — | OWN-02 |

## 20. Riesgos de migración

| ID | Riesgo | Probabilidad | Impacto | Mitigación |
| --- | --- | --- | --- | --- |
| R-01 | Operar en Hobby con uso comercial | Alta si no se decide | Suspensión/incumplimiento | OWN-01 |
| R-02 | Workers sin scheduler tras cutover | Alta sin acción | Emails y recordatorios no salen | §17 opción A antes de V1 |
| R-03 | Rate limit anónimo global por falta de IP | Cierta con código actual | Login OTP degradado | AUD-004 |
| R-04 | Secretos productivos en Preview | UNKNOWN | Exposición de datos prod en ramas | Separar env (§8) |
| R-05 | Redirect apex→www invertido | Cierta con config actual | SEO/canonical/cookies inconsistentes | AUD-010 |
| R-06 | Bloqueo de IPs en Brevo | Media (fecha estimada ≥ 2026-10-26) | OTP y transaccional caídos en cualquier host | AUD-006 |
| R-07 | Pausa por límites Hobby en pico | Baja-media | Indisponibilidad hasta 30 días | Monitoreo de uso; OWN-01 |
| R-08 | GPX > 4.5 MB | Media | Import falla 413 | AUD-015 |
| R-09 | Doble despliegue Netlify/Vercel desde la misma rama | Cierta mientras convivan | Builds con env no validado | Política de auto-deploy |
| R-10 | Staging indexado | Media | SEO duplicado | `robots` por entorno |
| R-11 | Rollback limitado por renovación TLS de Netlify | Baja | Netlify sin certificado válido tras semanas fuera de DNS | Ventana de rollback acotada (fecha de expiración Netlify UNVERIFIED) |
| R-12 | Precedencia `A` manual vs `ALIAS` de sistema al editar la zona | Baja | Apex sin resolución breve | Verificar resolución autoritativa inmediatamente tras el cambio; TTL 60 s |
| R-13 | Caches ISR separados durante convivencia | Baja | Contenido hasta 60–300 s desfasado | Aceptable; cutover rápido |
| R-14 | Clave de cifrado de pases distinta en Vercel | Baja-media | QR existentes indescifrables | Copiar valor exacto de producción; restore test |

## 21. Blockers

Bloquean un cutover productivo con V1 (no la preparación):

1. OWN-01 plan Vercel / uso comercial.
2. AUD-002 mecanismo de workers.
3. AUD-004 IP cliente.
4. AUD-005 env parity y separación Production/Preview.
5. AUD-010 dirección del redirect de dominio.
6. AUD-023 allowlist de redirects en Supabase para Preview (solo si se usa OAuth en Preview).

Bloquean operación real independientemente del host: AUD-006 (Brevo IPs), AUD-019 (estado Supabase prod), AUD-020 (AppSec final), PEND-LEGAL.

## 22. Enfoque zero-downtime (readiness, no ejecutado)

1. Netlify sigue sirviendo producción sin cambios.
2. Preparar Vercel sin tocar el dominio: corregir configuración de dominios (primario apex), desactivar auto-assign de dominios productivos o auto-deploy hasta validar, separar env por entorno.
3. Reconciliar build/config en una rama: cambios de código AUD-004/AUD-015, disparo de workers, `health` y `robots` por entorno, retirada planificada de dependencias Netlify sin borrarlas aún.
4. Configurar variables (§8) sin copiar valores a documentos.
5. Validar Preview (`staging.runiismty.com`): build, rutas, SSR/ISR, APIs, headers/CSP, smoke de navegador.
6. Validar providers en Preview: Supabase (no productivo), Brevo `allowlist`, OAuth, Cloudinary (cuando aplique).
7. Dominio/certificado: el certificado `*.runiismty.com` + apex ya existe en Vercel con auto-renew; confirmar validez el día del cambio.
8. Preparar el cambio DNS: registrar los valores actuales (`@ A 75.2.60.5`, `www CNAME runiis-web.netlify.app`) como plan de rollback; TTL ya es 60 s.
9. Verificar el camino de rollback (Netlify deploy publicado intacto, env Netlify intacta).
10. Cambiar tráfico: eliminar `@ A` manual (el `ALIAS` de sistema toma el apex) y reapuntar/eliminar `www CNAME`; comprobar resolución autoritativa y pública.
11. Smoke de producción: `/`, `/api/health` (`production`), `/eventos`, `/robots.txt`, `/sitemap.xml`, redirect `www`→apex, headers.
12. Validación técnica: OTP, callback OAuth, emisión QR, worker run registrado en `infra.worker_run`, invalidación de cache.
13. Mantener Netlify como rollback durante una ventana acotada.
14. Retirar Netlify (dominio, env, sitio, dependencias de código) solo con aprobación final del owner.

Secuenciación preferente (INFERENCE): ejecutar los pasos 1–12 mientras producción solo sirve el placeholder, de modo que el lanzamiento de V1 sea un despliegue normal en Vercel.

## 23. Enfoque de rollback (readiness)

| Elemento | Qué restaurar |
| --- | --- |
| DNS | Recrear `@ A 75.2.60.5` y `www CNAME runiis-web.netlify.app.` (TTL 60) |
| Netlify | Conservar el deploy de producción publicado, la configuración de dominio `runiismty.com` y `force_ssl` |
| Env | No modificar ni borrar variables Netlify durante la ventana |
| Scheduler | Si se movió a Supabase, sus jobs deben apuntar a la URL del host activo o pausarse; los Scheduled Functions de Netlify solo existen si el deploy publicado los incluye |
| Estado | La aplicación es stateless; el estado vive en Supabase (compartido por ambos hosts). Cambios de datos durante la ventana Vercel permanecen válidos tras el rollback. Caches ISR del host restaurado pueden servir contenido de hasta 300 s |
| Sesiones | Cookies host-only del mismo dominio y mismo proyecto Supabase: sobreviven al rollback |

Disparadores de rollback: `/api/health` distinto de 200 o de `production`; tasa de 5xx sostenida; fallos de OTP o del callback OAuth; worker sin ejecución en más del doble de su intervalo; fallo P0 de email; CSP bloqueando scripts propios; certificado inválido.

Con producción en placeholder, el estado afectado por un rollback es nulo.

## 24. Criterios de aceptación de la futura migración

1. `pnpm run build` local PASS sobre el commit candidato.
2. Build Vercel Preview PASS sobre el mismo commit (log con pnpm 11.8.0 y Next 16.3.6).
3. Paridad de rutas: todas las páginas y route handlers del build local presentes en Vercel; 404 esperados idénticos.
4. Paridad SSR y ISR: `/` revalida a 60 s; `/eventos/[slug]` on-demand + invalidación por tag verificada tras una mutación de edición.
5. Paridad API: suite de integración apuntando al Preview (sin datos productivos) o smoke de endpoints críticos (session, events, availability, OTP en `allowlist`).
6. Paridad de headers: HSTS, CSP pública (sin nonce) y privada (nonce + `strict-dynamic`), `Reporting-Endpoints`, `Referrer-Policy` especial en `/auth/callback` y `/recordatorios/confirmar`, `Permissions-Policy` de `/scanner`.
7. Paridad de redirects: `www`→apex 308/301; slugs históricos 308.
8. Paridad de entorno: tabla §8 completa sin valores; `/api/health` reporta el entorno correcto en cada scope; Preview sin secretos productivos.
9. Smoke de navegador (Playwright E2E public + account) contra Preview.
10. OAuth Google extremo a extremo en Preview y en producción.
11. Supabase: sesión, RLS y comandos con usuario real de prueba en entorno no productivo.
12. Brevo: envío `allowlist`, webhook autenticado recibido, verificación de IPs autorizadas.
13. Cloudinary: carga de imágenes públicas; upload firmado cuando exista.
14. Observabilidad: evento de prueba Sentry desde Vercel; PostHog con etiqueta de entorno (cuando se integren).
15. Workers: cada worker HTTP registra ejecución en `infra.worker_run` desde el mecanismo elegido; sin duplicados con Netlify.
16. Rate limit anónimo: dos IP distintas obtienen buckets distintos en Vercel.
17. Línea base de rendimiento §191 (LCP, INP, CLS, JS público) medida en Vercel.
18. Plan de rollback ensayado (comprobación de valores DNS y deploy Netlify intactos).
19. OWN-01 resuelta y registrada.

## 25. Fuentes consultadas (2026-10-01)

| Fuente | Dato confirmado | Implicación |
| --- | --- | --- |
| vercel.com/docs/cron-jobs/usage-and-pricing (last_updated 2026-07-15) | Hobby: 100 jobs, mínimo 1/día, precisión ±59 min; Pro: 1/min | AUD-002 |
| vercel.com/docs/limits/fair-use-guidelines (2026-09-14) | Hobby solo uso personal no comercial; ejemplos de uso comercial | AUD-001 |
| vercel.com/docs/plans/hobby (2026-09-14) | Uso incluido, logs 1 h, pausa 30 días al exceder, 100 deploys/día, Vercel Authentication | §18 |
| vercel.com/docs/deployments/environments (2026-09-17) | Preview branch + branch domain + env por rama en Hobby; Custom Environments Pro/Enterprise | §4, §9 |
| vercel.com/docs/functions/limitations (2026-08-24) | Hobby 300 s, 2 GB, body 4.5 MB, una región | AUD-015 |
| vercel.com/docs/headers/request-headers (2025-12-13) | `x-forwarded-for`/`x-real-ip`/`x-vercel-forwarded-for` sobrescritos por Vercel | AUD-004 |
| vercel.com/docs/package-managers (2026-08-11) | pnpm 6–10 en tabla; Corepack/`packageManager` | AUD-042 |
| docs.netlify.com/build/functions/scheduled-functions | Solo en deploys publicados; límite 30 s | AUD-038 |
| supabase.com/docs/guides/auth/redirect-urls | Globs; patrón `https://*-<team>.vercel.app/**` | AUD-023 |
| supabase.com/docs/guides/cron | HTTP desde jobs; ≤8 concurrentes; ≤10 min | §17 |
| help.brevo.com/hc/en-us/articles/5740111683858 | Bloqueo automático de IPs desconocidas tras 30 días | AUD-006 |

Nota de verificación: un contexto de sesión afirmaba un límite de body de 100 MB en Vercel; la documentación oficial vigente indica 4.5 MB y el changelog citado devolvió 404. Se adopta 4.5 MB.
