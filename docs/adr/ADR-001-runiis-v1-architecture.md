# ADR-001 — RUNIIS WEB V1 architecture and engineering conventions

Status: accepted · 2026-09-27 · Applies to all V1 work. Functional authority remains
`docs/RUNIIS_WEB_SYSTEM_MASTER_SPEC_V2.md` (the Master); this ADR fixes how it is realised.

## Verified context

- Next.js App Router app at repository root; Netlify builds root (`netlify.toml`, `@netlify/plugin-nextjs`).
  Production = `main` → `runiismty.com`; staging = branch `staging` → `staging--runiis-web.netlify.app`.
- Supabase: SalvaOps binding reaches only production (`runiis-web-prod`). Staging project exists but is
  not bound, so remote migrations can only be applied to production through SalvaOps. Local Docker
  Supabase is the pre-production validation environment.
- Remote PostgREST exposes only `public` and `graphql_public`; exposed schemas cannot be changed through
  available authority. Media provider is Cloudinary (reconciles Master R2 references; `ObjectStorage`
  abstraction unchanged). Email: Brevo HTTP API (app) + Brevo SMTP (Supabase Auth OTP).

## Decisions

1. **Schemas.** Tables live in `app` (domain), `private` (internal data + helpers + privileged
   functions), `audit`, `infra`. `public` is the API facade only: functions, no tables.
   Every `app` table has RLS enabled at creation. `private`/`audit`/`infra` tables get no grants to
   `anon`/`authenticated`.
2. **Commands and queries.** Every state change is a Postgres command function:
   `private.<verb_noun>(...)`, `security definer`, `set search_path = ''`, fully qualified names,
   `revoke all ... from public, anon`, `grant execute` only to the roles that may call it.
   Each is exposed through `public.<verb_noun>(...)`, a `security invoker`, `language sql` one-line
   wrapper with the same signature and grants. A command authorises the caller itself
   (`auth.uid()` + `private` helpers from Master §157), validates every input, takes locks in the
   canonical order, mutates, writes `audit.audit_log` and `infra.outbox_event`, and returns `jsonb`.
   Reads that RLS can express run as invoker; reads needing cross-row projections use the same
   private/definer + public/invoker pair and return explicit `jsonb` projections (never private columns).
   Command functions must be safe when called directly through PostgREST with a user JWT.
3. **Lock order** (Master §37): `app.edition` row → `app.modality_capacity` rows ordered by
   `modality_id` → request/registration/pass rows. Capacity and availability are always recomputed
   inside the transaction from confirmed Registrations + effective holds (`status = 'ACTIVE' and
   expires_at > now()`); nothing stores available slots. "Effective" uniqueness that depends on time
   (participant claims, one pending request per buyer+Edition) is enforced under the Edition lock and
   backed by partial unique indexes on `status`, with expired rows materialised before the check.
4. **Errors.** Domain failures: `raise exception using errcode = 'P0001', message = '<CODE>', detail = '<json>'`
   where `<CODE>` is a Master §167/§178 code. `lib/server/http/errors.ts` maps codes to HTTP status.
   Unknown errors → `500 INTERNAL_ERROR` with `request_id`; never stack traces or SQL text.
5. **HTTP API.** `/api/v1/*` route handlers; `{data, meta}` / `{error:{code,message,request_id,details}}`;
   zod input validation (`400 VALIDATION_ERROR`); cursor pagination (opaque cursor); `x-request-id`.
   Critical mutations accept `Idempotency-Key`: the handler computes `request_hash` = sha256 of canonical
   JSON body and the command stores/replays `infra.idempotency_record` in the same transaction
   (same key+hash → original response; same key+different hash → `409 IDEMPOTENCY_CONFLICT`;
   actor re-authorised before replay). Authenticated responses: `Cache-Control: private, no-store`.
6. **Supabase access from Next.** User-context calls use the cookie session client (`@supabase/ssr`)
   so `auth.uid()` is the real caller. `SUPABASE_SECRET_KEY` is used only in `server-only` modules for
   SYSTEM work (workers, webhooks, provider callbacks) and never reaches the browser. Identity on the
   server comes from `auth.getClaims()`/`getUser()`, never from `getSession()` alone or user metadata.
   Staff roles come only from `app.staff_role_assignment`.
7. **Auth.** Google + Email OTP (6 digits, 600 s, ≥60 s between requests). OTP requests go through
   `/api/v1/auth/otp` (rate-limited, counted as SECURITY usage). `private.hook_before_user_created`
   rejects active blocked identities (enabled locally in `supabase/config.toml`; remote enablement is an
   Auth-config operation outside current SalvaOps capabilities). Onboarding re-checks blocked identity.
8. **QR credentials.** Token = 32 random bytes, base64url; QR payload `RN1.<token>`;
   `token_hash` = sha256(token) hex; ciphertext = AES-256-GCM, stored `iv(12)||tag(16)||ct` in `bytea`.
   Key v*n* = HKDF-SHA256(ikm = env `PASS_CREDENTIAL_ENCRYPTION_KEY_V<n>`, salt `runiis-pass-credential`,
   info `v<n>`, 32 bytes). Tokens are generated server-side immediately before the issuing command and
   passed as (hash, ciphertext, key_version); plaintext is never stored, logged or cached. Rendering
   decrypts server-side after authorisation and returns SVG with `private, no-store`.
9. **Rate limits** are enforced in the database (`infra` counters consumed inside commands) with the
   Master §179 initial values as configuration.
10. **Workers.** DB-only workers are `private.worker_<key>()` scheduled with `pg_cron` from migrations and
    recorded in `infra.worker_run`. Provider-dependent workers (outbox/email dispatch, provider
    reconciliation, avatar processing/cleanup, usage reconcile) are `/api/internal/workers/<key>` route
    handlers authenticated with `INTERNAL_CRON_SECRET` (constant-time compare), triggered by Netlify
    Scheduled Functions and kicked best-effort after commits. Outbox claim uses
    `FOR UPDATE SKIP LOCKED` + lease, exponential backoff with jitter, `ESCALATED` + AdminTask.
11. **Providers behind interfaces** (`lib/server/providers/*`): EmailProvider (Brevo; Mailpit locally),
    ObjectStorage (Cloudinary, folders `runiis/<env>/...`, signed server-side uploads, pending assets
    private), MapTileProvider (OpenFreeMap style URL), AnalyticsProvider (PostHog, no PII, env tag),
    ErrorMonitoringProvider (Sentry), AuthProvider (Supabase). Domain code never imports provider SDKs.
    Non-production email: `EMAIL_DELIVERY_MODE` = `live` | `allowlist` | `capture`.
12. **Caching.** Editorial/public pages cached with tags (`editions`, `edition:<id>`, `ranking`,
    `profile:<publicId>`) and invalidated per Master §60 from one mapping module; availability and
    OPEN rankings read fresh; authenticated responses never shared-cached.
13. **Frontend.** Tailwind CSS v4 with Foundations tokens (Master §181–191) as the only styling source;
    shadcn/Radix primitives restyled to tokens; Lucide icons; `next/font` Archivo Narrow + Inter;
    MapLibre lazy-loaded; admin (`/admin`) and scanner (`/scanner`) isolated from public bundles.
14. **Configuration gaps are explicit, not invented.** `app.platform_settings.default_whatsapp_phone_e164`
    is nullable until PEND-OPS-001 provides the real number; NULL means "not configured" and blocks
    EXTERNAL_WHATSAPP registration readiness unless the Edition has its own number. Legal document
    versions are never seeded outside local/test data.
15. **Testing.** Vitest (unit; integration against local Supabase over HTTP), pgTAP via
    `supabase test db`, Playwright (E2E desktop+mobile, axe), k6 via the `grafana/k6` image.
    Test names carry Master requirement IDs (e.g. `CAP-001`) for traceability.

## Amendment 1 — security decisions from the T11 threat model (2026-09-27)

Requirement IDs refer to `.salvaops-agent-evidence/T11-appsec-threat-model/threat-model.md` (SEC-nnn).

A1. **QR issuance is SYSTEM-only (SEC-030 option B).** No `anon`/`authenticated`-callable function
    accepts or returns credential material (token, hash, ciphertext, key version). User/staff
    commands (FREE registration, confirm, revalidate-and-confirm, replace) create or retire
    Registration/ParticipantPass/credential state atomically; the ACTIVE credential is issued by
    `private.issue_pass_credential(...)`, executable only by `service_role`, called by the server
    immediately after commit, retried from the outbox (`ParticipantPassIssued`/replacement effects) and
    lazily on authorised render. It issues only for an ACTIVE pass of a CONFIRMED Registration with no
    ACTIVE credential (partial unique index keeps one). Replacement retires the old credential in the
    staff command (it stops authorising immediately) and the next version is issued the same way.
    This keeps the Master's symmetric `PASS_CREDENTIAL_ENCRYPTION_KEY_V<n>` design.
A2. **Credential crypto** adds AAD `RN1|<participant_pass_credential_id>|<key_version>` and a post-decrypt
    `sha256(token) == token_hash` check (fail closed); keys are validated at boot; every key version
    referenced by an ACTIVE credential stays configured (SEC-033..035).
A3. **Pass emails** (Master §133/§229) carry the recipient's own QR (Guest QR to the buyer) rendered at
    dispatch time only; `render_context_snapshot` stores ids, never token/ciphertext/rendered QR; buyer
    summaries never include Friends' QR. Mailbox exposure is an accepted V1 risk mitigated by
    replacement. Replacement is staff-only in V1 (Master §168).
A4. **Direct-API safety.** Every callable function is safe without Next: it validates all inputs,
    derives the actor only from `auth.uid()` (no actor/owner/staff parameter on user-callable
    functions), derives staff scope from the target row, re-raises constraint violations as domain codes
    with client-safe `detail` (ids the caller owns only), and returns explicit projections. Default
    privileges in `public` are revoked; grants follow an allowlist checked by pgTAP; `pg_graphql` is
    dropped; PostgREST `max_rows` caps lists. A PostgREST pre-request gateway secret (SEC-001) is
    deferred (needs per-environment secret provisioning); SEC-002..008 are mandatory instead.
A5. **Idempotency** hash is computed inside the command from its own canonical arguments (the handler
    hash is advisory); uniqueness uses `NULLS NOT DISTINCT`; replay re-authorises; stored responses
    never contain secrets (SEC-140).
A6. **Rate limits are two-layer**: a committed pre-check (`private.consume_rate_limit`) called by Next
    before the command (counts failures; per actor and per client IP for anonymous endpoints) plus
    success-path counters inside commands (enforced for direct callers) (SEC-141).
A7. **Auth hardening enforced in the database** so it holds even where remote Auth config cannot be
    changed through available authority: a trigger on `auth.users` rejects any non-empty password
    (OTP/Google only, SEC-040) and rejects active blocked identities by normalised email; a trigger on
    `auth.identities` rejects blocked Google subjects (SEC-047); the Auth hook is also enabled locally.
    Remote OTP timings, confirmations, redirect allowlist and CAPTCHA stay a verification gap owned by
    the orchestrator. OTP request responses are identical for every email state (SEC-043).
A8. **Sessions**: no browser Supabase client; all auth operations go through route handlers; session
    cookies HttpOnly, Secure, SameSite=Lax; callback `next` limited to an internal allowlist (SEC-044/049).
A9. **Web platform**: nonce CSP on dynamic routes, security headers, image optimizer limited to the
    RUNIIS Cloudinary cloud, no `dangerouslySetInnerHTML` except escaped JSON-LD, markdown without raw
    HTML and with scheme allowlist, MapLibre text-only sinks (SEC-060..066). Cached public pages never
    read cookies. PostHog: no autocapture/replay, random analytics id, query strings stripped; Sentry:
    `sendDefaultPii: false` with scrubbing (SEC-110/111). `EMAIL_DELIVERY_MODE` unset → `capture` outside
    production and refuse-send in production (SEC-083). Cloudinary pending avatars use `type=authenticated`
    (SEC-090). Worker kick URLs are built from `APP_BASE_URL` only (SEC-070).
A10. **Minors**: `is_searchable = false` for MINOR_NONCOMPETITIVE profiles (not user-selectable); guardian
    relation never public. A GuardianAssignment becomes ACTIVE when the guardian (and, for a minor
    RunnerProfile, the minor) confirms in-app; per-event in-person verification stays mandatory
    (Master §21) (SEC-014/120).

## Layout

```
app/                      routes: (public) pages, entrar, auth/callback, onboarding, cuenta, inscripcion,
                          admin, scanner, api/v1, api/webhooks, api/internal/workers, sitemap, robots
lib/shared/               pure TS safe for client and server
lib/server/               server-only: env, supabase clients, http (envelope/errors/handler/idempotency),
                          auth (session/actor/guards), crypto, providers, cache, workers, domain/<module>
components/ui/            design-system primitives;  components/<feature>/  feature components
supabase/migrations/      <timestamp>_<nnn>_<name>.sql;  supabase/tests/database/*.test.sql (pgTAP)
supabase/seed.sql         synthetic local/test data only
tests/unit, tests/integration, tests/e2e, tests/load
netlify/functions/        scheduled triggers only
scripts/                  local tooling
```

## Local environment

Local Supabase (project id `RUNIIIS_WEB`): API `127.0.0.1:54621`, DB `54622`, Mailpit `54624`.
Supabase CLI is linked to the staging project: never run remote-affecting Supabase CLI commands
(`db push`, `link`, `--linked`, `functions deploy`, `secrets`); remote DB work goes through SalvaOps.
Shared local DB operations (`db reset`, pgTAP, integration suites) run through the lock-guarded
`pnpm db:*` scripts.
