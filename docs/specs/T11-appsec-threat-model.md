> **Provenance.** Versioned copy of a Phase 1 durable specification: Threat model and secure-by-design requirements (T11, SEC-nnn). Promoted from `.salvaops-agent-evidence/T11-appsec-threat-model/threat-model.md` (git-ignored, no remote backup before this copy) by WU-P1-B-authority-docs on 2026-10-01, base commit `b6dc5b1` (Roadmap 7.4.4, audit AUD-025).
>
> - Source sha256: `27f794518445a2489c0ac10f5b0cc3658dc5b8bf3254de7ac6b0500a64d2cdaf`
> - Source size: 56249 bytes
> - Everything below the marker line is byte-for-byte identical to the source. Verify with `tail -c 56249 <this file> | sha256sum`, which must print the source sha256.
> - Authority: derived specification under the Master and ADR-001 (cited by ADR-001 Amendment 1 and by code as SEC-nnn). A change needs a new version, not an in-place edit. Platform facts that changed afterwards (hosting, scheduler, client IP) are in ADR-002.

<!-- BEGIN VERBATIM SOURCE -->
# RUNIIS WEB V1 — Threat model and secure-by-design requirements

task T11-appsec-threat-model · mode threat-model · 2026-09-27 · salvaops-appsec
Inputs: ADR-001 (full); Master §9, §12–25, §49–52, §60–85, §115–149, §152, §156–180, §195–198, §205, §208, §229–230;
repo bootstrap (`supabase/config.toml`, `package.json`, `pnpm-workspace.yaml`, `node_modules/fast-xml-parser@5.11.1`, `.gitignore`, `.env.example` key names only).
No product code exists; nothing was attacked; no secret file was read.
Basis tags: [O] observed in repo · [S] Master/ADR text · [I] inference from platform behaviour (proved/disproved by the listed test) · [H] product/owner decision needed.
Rank = likelihood × impact (H/M/L). Owners are orchestrator task IDs; `F*` = frontend tasks.

---

## 1. Scope

### 1.1 Assets (highest first)
- A1 Sessions/identity: `sb-*` access+refresh cookies, OTP codes, Google identity links, `auth.users`.
- A2 QR credentials: plaintext `RN1.<token>`, `token_ciphertext`, `PASS_CREDENTIAL_ENCRYPTION_KEY_V<n>`.
- A3 PII: full_name, DOB, sex, phone, emergency contact, email, guardian relation, Guest PII, form responses; minors 15–17 (§19).
- A4 Privileged capabilities: staff role assignment, ban/identity-lock/unban, PII export, confirm/cancel/revalidate, capacity/price, closure/reopen, campaigns.
- A5 Integrity data: capacity/holds/claims, Registrations, attendance, DistanceCredit, rankings, achievements, audit log, consent/suppression history.
- A6 Secrets (names per `.env.example` [O]): `SUPABASE_SECRET_KEY`, `BREVO_API_KEY`, Brevo SMTP key, `BREVO_WEBHOOK_AUTH_SECRET`, `CLOUDINARY_API_SECRET`, `INTERNAL_CRON_SECRET`, `GOOGLE_CLIENT_SECRET`, `SENTRY_AUTH_TOKEN`, SalvaOps provider tokens.
- A7 Media: pending (unmoderated, may carry EXIF/GPS) and approved avatars; event media.
- A8 Availability: OTP login; Brevo daily quota shared by Supabase-SMTP OTP and app mail [S §133, ADR ctx]; race-day scanner; Edition capacity.

### 1.2 Actors (Master §9) and abuse of interest
| Actor | Abuse of interest |
|---|---|
| ANONYMOUS | Holds the publishable key → calls GoTrue `/auth/v1/*` and PostgREST `/rest/v1/rpc/*`, `/graphql/v1` directly; OTP/reminder email bombing; enumeration; XSS delivery |
| AUTHENTICATED_INCOMPLETE | Cheap sybil accounts via OTP; direct RPC with a valid JWT before READY |
| RUNNER / MINOR_RUNNER | BOLA on others' requests/passes/guests; people-search harvesting; hold hoarding |
| BUYER | Obtain Friend QR/PII; accept waivers for Friends; register people without consent |
| FRIEND | Learn co-participants' data through a shared request |
| GUEST | Victim only (PII held by buyer, no account) |
| GUARDIAN | False guardianship over an unrelated minor |
| STAFF_ADMIN (GLOBAL/EDITION) | EDITION admin acting globally; self-grant; export abuse |
| STAFF_OPERATOR | Cross-Edition actions; PII export without permission; ban |
| STAFF_CHECKIN | PII harvesting via lookup; MANUAL_VERIFY abuse; shared device |
| STAFF_MODERATOR | Access to PII beyond photo + display name |
| SYSTEM | Confused deputy on attacker-influenced input; secret exposure |
| External | X1 forged webhook sender · X2 dependency/third-party script compromise · X3 insider with DB/backup/provider-console access · X4 attacker controlling a same-site host |

### 1.3 Trust boundaries
- TB1 Browser ↔ Netlify CDN/edge (cache; `proxy.ts` session refresh).
- TB2 Edge ↔ Next route handlers / RSC / server actions (Netlify Functions; cookie auth).
- TB3 Next ↔ GoTrue (OTP, OAuth PKCE, admin ban). **GoTrue is also reachable directly from the Internet with the publishable key.**
- TB4 Next ↔ PostgREST `public` RPC (user JWT or secret key). **PostgREST is also reachable directly** (`/rest/v1`, `/graphql/v1`).
- TB5 PostgREST ↔ Postgres: `public` invoker wrappers → `private` definer commands → `app`/`audit`/`infra`; RLS + helpers (§157).
- TB6 pg_cron DB workers (`private.worker_*`, run as owner, bypass RLS).
- TB7 Netlify Scheduled Functions / post-commit kicks → `/api/internal/workers/<key>` (INTERNAL_CRON_SECRET) → provider APIs with secret keys.
- TB8 Brevo → `/api/webhooks/email-provider`.
- TB9 Next → Brevo HTTP API; GoTrue → Brevo SMTP.
- TB10 Browser → Cloudinary signed upload; Cloudinary CDN → public; Next → Cloudinary Admin API.
- TB11 Browser → PostHog / Sentry / OpenFreeMap tiles; Next → Sentry (data egress).
- TB12 Deploy contexts: production (`main`), staging branch, deploy previews, local (secret scoping, §195).
- TB13 Scanner devices (shared staff phones).

Entry points: §165–177 + `/api/v1/auth/otp`, `/auth/callback`, `/api/webhooks/email-provider`, `/api/internal/workers/*`, server actions (if any), `/_next/image`, and the direct platform paths `/rest/v1/rpc/*`, `/graphql/v1`, `/auth/v1/*`.

---

## 2. Threats per boundary (material only)
Format: `Txx [STRIDE] rank — scenario → SEC`

### TB3/TB4 — direct platform APIs (the bypass boundary)
- T01 [E] H×H — Anyone with a JWT (free via OTP) + publishable key calls every `public.*` function granted to `authenticated`, skipping Next zod, Origin check, IP limits, Idempotency handling, error mapping and — per ADR 5/8 — the handler-computed `request_hash` and QR credential material. → SEC-001..008, 030, 140, 141
- T02 [E/I] H×H — Supabase default privileges auto-grant new `public` functions/tables to `anon`/`authenticated` [I]; Postgres grants EXECUTE to PUBLIC on every new function; wrapper grants drift from definer grants. → SEC-002
- T03 [D/I] M×H — `create extension postgis|pg_trgm|unaccent|pgcrypto` landing in `public` exposes hundreds of anon-callable RPCs (CPU DoS via geometry/trigram functions) plus `public.spatial_ref_sys` without RLS [I]. → SEC-003
- T04 [E/I] M×M — `graphql_public` (pg_graphql) is a second API over the same objects with different reflection rules [S ADR ctx]. → SEC-004
- T05 [I] M×M — Raw Postgres errors reach direct callers: `unique_violation` detail `Key (edition_id, runner_profile_id)=(…)` reveals other users' claims; P0001 `detail` JSON returned verbatim. → SEC-005
- T06 [E] H×H — SECURITY DEFINER pitfalls: actor/owner passed as a parameter (confused deputy); `auth.uid()` NULL (anon JWT or secret key) not failing closed (`where buyer_profile_id = NULL` matches nothing and the command "succeeds"); definer owner = table owner so RLS is bypassed and every definer read must filter explicitly; `returns setof app.x` leaks all columns; dynamic SQL; unqualified names; `has_staff_role(role, NULL)` matching EDITION rows via `is not distinct from`. → SEC-006, 020
- T07 [I] M×M — Caller controls `limit`/`Range` on setof RPCs (local `max_rows = 1000` [O]) → people/participant harvesting beyond the 20/page contract. → SEC-008
- T08 [S] H×H — Pre-account takeover: local Auth has `enable_confirmations = false` and password sign-up available (`minimum_password_length = 6`) [O]. Attacker `POST /auth/v1/signup` {victim email, password} → auto-confirmed user; victim later signs in by OTP or Google (auto-linked on verified email [I]) into the attacker-held account and onboards PII. → SEC-040
- T09 [D/S] H×H — OTP abuse bypassing `/api/v1/auth/otp`: direct `/auth/v1/otp` with local `max_frequency = "1s"`, `otp_expiry = 3600` [O] (ADR: 60 s / 600 s) → victim bombing, global Brevo quota exhaustion (shared with app mail) → nobody can log in on race day; 6-digit guessing limited only per IP (`token_verifications`). → SEC-041, 042
- T10 [I] M×L — Enumeration of existing/banned/blocked emails via OTP route responses, hook errors, timing. → SEC-043
- T11 [S] M×H — Blocked identity re-signup: `[auth.hook.before_user_created]` is commented out locally [O]; remote enablement "outside SalvaOps capabilities" [S ADR 7] while the infra report lists Auth Config read/write on the SalvaOps Supabase token [S] (reconcile); email alias variants. → SEC-047

### TB1/TB2 — browser ↔ edge ↔ Next
- T12 [T] M×H — CSRF on cookie-authenticated handlers: SameSite=Lax (the @supabase/ssr default [I]) does not cover same-site subdomains (`*.runiismty.com`, e.g. an email-tracking CNAME), GET side effects, or server actions with loose origins; login CSRF / cookie tossing from a same-site host. → SEC-050, 049
- T13 [S] M×H — `/auth/callback?next=` open redirect (`//evil`, `/\evil`, encoded variants); wildcard redirect allowlists (deploy previews) on the prod Auth project → code/session capture. → SEC-044, 045
- T14 [E] H×M — Ban / identity lock / staff revocation mid-session: access JWT lives ≤ 3600 s [O `jwt_expiry`] and `getClaims()` checks signature, not revocation [I]; cached actor objects. → SEC-046, 021
- T15 [E] M×H — Authorization from `user_metadata` (user-writable), `getSession()`, proxy-only checks or hidden UI (§230). → SEC-048, 066
- T16 [I] M×H — XSS ⇒ session theft because `sb-*` cookies are JS-readable by default [I]. Sinks: markdown/rich-text blocks, legal docs, MapLibre `setHTML` popups, GPX POI names, display names, JSON-LD, `wa.me` URLs. → SEC-049, 060..063
- T17 [I] M×H — Shared-cache leaks: authenticated/admin responses cached by Netlify CDN or Next data cache; `Set-Cookie` (refreshed session) on cacheable responses; `'use cache'` over user/staff data; user chrome baked into cached public pages; public profile/avatar still served after ban/removal. → SEC-051..053
- T18 [I] L×M — Clickjacking of account/admin/scanner; missing HSTS/nosniff; Referer leaking `?code=`/tokens to tiles/CDNs. → SEC-064
- T19 [D] L×M — `/_next/image` / Netlify Image CDN as open proxy if `remotePatterns` is wildcarded. → SEC-065

### TB5 — domain authorization (BOLA / escalation)
- T20 [I/T] H×H — ID swap on `/registration-requests/:id`, `/me/passes/:passId`, `/me/guests/:id`, `/friendships/:id/*`, `/reminders/:id` and their RPCs (UUIDs are not a control). → SEC-010, 015
- T21 [I] H×H — Buyer obtains a Friend's QR (render-qr on the Friend pass, FREE-flow response, buyer summary email, idempotency replay) — violates §84/§205/§229. → SEC-011, 030, 033
- T22 [I] M×M — Friend/Guest PII over-exposure in buyer projections (`eligibility_snapshot`, category→age, phones). → SEC-012
- T23 [E] M×H — Mass assignment: `PATCH /me/profile` setting `full_name`, `date_of_birth` after READY, `account_state`, `profile_readiness`; `PATCH /me/guests/:id` changing owner. → SEC-016
- T24 [E] M×H — Buyer records a waiver for a Friend adult (§124); unrelated adult claims guardianship of a minor (§20 activation undefined [H]). → SEC-013, 014
- T25 [E] H×H — EDITION-scoped staff targets another Edition's resources (command trusts client `edition_id`); EDITION ADMIN grants roles; self-grant; a "bootstrap first admin" public path; revoked staff with live JWT. → SEC-020..022
- T26 [I] M×H — PII over-exposure to CHECKIN (lookup harvesting), MODERATOR, OPERATOR export without explicit permission; audit snapshots with full PII readable by broad staff. → SEC-023, 024, 112
- T27 [T] M×M — CSV/formula injection in participant export via display names/form responses. → SEC-025
- T28 [T] M×M — Idempotency: SYSTEM rows with `actor_auth_user_id NULL` never collide (NULLs distinct in UNIQUE) → duplicate effects; caller-supplied `request_hash` not bound to args; stored `response_body` replayed after authorization changes or containing secrets. → SEC-140
- T29 [D] H×M — Rate-limit bypass: DB counters consumed inside a command roll back when the command raises, so every failed attempt is free [I from ADR 4+9]; per-user limits vs sybil accounts; no IP dimension for anonymous endpoints; OTP/anonymous reminders absent from §179. → SEC-141
- T30 [D] M×H — Hold hoarding: sybil accounts create PENDING requests (24 h holds) to exhaust a popular Edition. → SEC-142

### QR credentials (ADR 8)
- T31 [S/T] H×H — ADR 8 has the Next handler generate the token and pass `(hash, ciphertext, key_version)` into the issuing command; ADR 2 makes that command callable directly with a user JWT. A buyer in the FREE flow (or an OPERATOR confirming) supplies credential material for other participants → knows/chooses a Friend's token, or pairs a known `token_hash` with an unrelated ciphertext so the Friend's rendered QR is invalid while the buyer's token checks in as the Friend. → SEC-030
- T32 [S] M×M — Replay/sharing: screenshot reuse, concurrent scans at two stations, old credential after replacement, cross-Edition scan, `public_code`/`registration_number` used as bearer for manual verify. Brute force infeasible (256-bit token). → SEC-031, 032, 036
- T33 [I] H×H — Token leakage: logs, Sentry, PostHog session replay of the pass page (QR SVG in DOM) [I], `render_context_snapshot`, outbox payloads, idempotency `response_body`, URLs/Referer, Brevo message logs and mailboxes if the QR is emailed (ADR silent [H]). → SEC-033, 037
- T34 [T] L×H — Ciphertext swapped between rows (no AAD), mismatched token rendered silently, key loss/rotation without version inventory, weak env key, same key across envs. → SEC-034, 035

### TB6/TB7 — workers and cron
- T35 [S/E] M×H — `/api/internal/workers/*` triggerable if the secret is unset (`undefined === undefined`), secret in query string (logs), GET triggers; post-commit kick URL built from `Host`/`X-Forwarded-Host` sends INTERNAL_CRON_SECRET to an attacker host. → SEC-070
- T36 [E] L×H — pg_cron job SQL built from data; `cron` schema reachable by API roles. → SEC-071

### TB8/TB9 — email
- T37 [S/T] M×M — Forged Brevo events (no payload signature; header/basic token only [I]) create suppressions (silence a victim's P0/P1 mail) or fake DELIVERED; replay; payload flood. → SEC-080
- T38 [T] M×M — HTML/header injection in emails via display names, Guest names, event names (phishing from the RUNIIS domain). → SEC-081
- T39 [D/R] H×M — Anonymous reminders to arbitrary recipients (bombing, quota, sender reputation); consent "confirmed" by mail-scanner GET prefetch. → SEC-082
- T40 [I] M×M — Non-production sends to real people; forgeable unsubscribe/preference tokens. → SEC-083, 084

### TB10 — Cloudinary
- T41 [I] H×M — Pending/rejected avatars publicly reachable: `type=upload` assets are public regardless of folder name [I]; ADR "pending assets private" names no mechanism. → SEC-090
- T42 [T/D] M×M — Over-broad signature (client alters folder/public_id/type/format/overwrite), SVG/HTML upload, MIME spoof, decompression bomb, oversize, signature reuse, on-the-fly transformation cost abuse, `fetch` delivery as proxy. → SEC-091
- T43 [I] M×H — EXIF/GPS (home location, incl. minors) retained in served or moderator renditions. → SEC-092
- T44 [I] M×M — Removed avatar still served from Cloudinary CDN / Next cache. → SEC-093

### GPX (admin upload)
- T45 [D] M×M — XML bombs / huge / deep files: fast-xml-parser 5.11.1 defaults `processEntities` enabled with `maxTotalExpansions: Infinity`, `maxNestedTags: 100` [O]; point floods → function OOM/timeout. XXE: external `SYSTEM` entities throw in this parser [O] — still reject DOCTYPE. → SEC-100
- T46 [T] M×H — Stored XSS via GPX `name`/`desc`/`link` into POI popups; prototype-pollution keys. → SEC-062, 101

### TB11 — analytics, logs, errors
- T47 [I] H×H — PII/tokens to PostHog: identify with email, autocapture/input capture, session replay of onboarding/pass/admin, `$current_url` with `?code=`/reminder tokens/search `q`. → SEC-110
- T48 [I] H×M — PII/tokens in Sentry (bodies, cookies, headers, breadcrumbs, URLs), Netlify function logs, Supabase API logs (GET RPC query strings). → SEC-111

### Minors
- T49 [I] M×H — Minors in public rankings/achievements/search, age inference, BIRTHDAY/marketing to minors, identified analytics for minors. → SEC-120

### TB12 — secrets and environments
- T50 [I] M×H — Secret reaching the client bundle (`NEXT_PUBLIC_*` misuse, server module imported by a client component), build logs, deploy previews; prod secrets or prod Supabase in staging/previews; same keys across envs (§195). Residual: legacy broad Vercel/Supabase tokens kept [S infra report]; `.env.production.local` present on the dev machine (content not read) [O]. → SEC-130, 131

### SSRF (none expected in V1)
- T51 [I] L×M — No server fetch of user URLs in V1. It would appear with: GPX import by URL; server-side Cloudinary upload with a user `file` URL or Cloudinary `fetch`/auto-upload delivery; server unfurling of DOCUMENT_LINK/IMAGE blocks; wildcard `/_next/image`; Sentry `tunnelRoute` forwarding to arbitrary hosts; worker kicks using the request host. → SEC-150

### Supply chain / devices
- T52 [T] L×H — Dependency or third-party script compromise with JS-readable cookies; lockfile committed and build-script allowlist `esbuild`, `unrs-resolver` [O]. → SEC-151
- T53 [I] M×M — Shared scanner phones keep staff session or participant data. → SEC-160

---

## 3. Secure-by-design requirements
Format: `SEC-nnn — requirement. owner | verify [§208 item / §205 row]`.
Test naming (ADR 15): pgTAP `supabase/tests/database/sec_nnn_*.test.sql`, Vitest `tests/integration/security/SEC-nnn.*`, Playwright `tests/e2e/security/SEC-nnn.*`.
"Direct RPC" = call `/rest/v1/rpc/<fn>` with the publishable key (± user JWT), bypassing Next.

### Data API surface
- SEC-001 — PostgREST gateway gate: `pgrst.db_pre_request = private.guard_request()` rejects any request without the server-held `x-runiis-gateway` value (hash stored in `private`, rotatable); Next user-context and secret clients always send it; the browser never calls PostgREST. Defense in depth only: SEC-002..008 must still hold. Remote role setting = SalvaOps op. owner T10-db-foundation (+T20-auth-rls clients) | verify: direct RPC and `/graphql/v1` without header → rejected, with header → OK [208 privilege escalation, role scope]
- SEC-002 — Grants by allowlist: first migration revokes default privileges in `public` (and every RUNIIS schema) for functions/tables/sequences from `public, anon, authenticated`; each function `revoke all … from public, anon, authenticated` then explicit grant; `anon` executes read projections only, never a command. owner T10 | verify: pgTAP enumerates `pg_proc` ACLs in public/private/app/audit/infra and diffs against a checked-in role→function allowlist [208 privilege escalation]
- SEC-003 — All extensions (`pgcrypto`, `pg_trgm`, `unaccent`, `postgis`, `btree_gist`) `with schema extensions`; `public` contains only RUNIIS wrapper functions (no tables, views, sequences, extension objects). owner T10 | verify: pgTAP inventory of `public` == allowlist; no `spatial_ref_sys` in `public` [208 RLS allow/deny]
- SEC-004 — Drop `pg_graphql` unless an ADR amendment needs it; if kept, introspection as anon/authenticated exposes only the allowlist. owner T10 | verify: POST `/graphql/v1` introspection → 404 or allowlist only [208 privilege escalation]
- SEC-005 — Error sanitation in the DB: commands trap `unique_violation`/`foreign_key_violation`/`check_violation`/`not_null_violation` and re-raise P0001 domain codes; `detail` carries only caller-owned ids; no `hint`; no row values, constraint or table names. owner T10 (pattern) + every domain task | verify: direct RPC with duplicate/foreign inputs → body contains no foreign UUID, no `Key (`, no relation name [208 secret leakage]
- SEC-006 — Definer template: `security definer`, empty `search_path`, fully qualified names; actor only from `auth.uid()` via `private.current_profile_id()`/`current_staff_member_id()`; no actor/owner/staff parameter on any `authenticated`-callable function; NULL uid → `AUTH_REQUIRED`; target row loaded `for update` before use; returns explicit `jsonb` projections (never `setof app.*`); dynamic SQL only via `format()` with `%I`/`%L` on allowlisted identifiers; no overloaded names in `public`. owner T10 (template + lint) + domain tasks | verify: pgTAP per command as anon, other runner, wrong-scope staff, banned, no-claims `authenticated` → all denied; catalog lint fails on any definer lacking an empty `search_path` in `proconfig` [208 BOLA/IDOR, privilege escalation, SQL injection]
- SEC-007 — Secret-key client confined: `lib/server/supabase/admin.ts` is `server-only`; ESLint `no-restricted-imports` allows it only from `lib/server/workers/**`, `app/api/webhooks/**`, `app/api/internal/**`, credential issuance and auth-admin modules; SYSTEM-only functions granted to `service_role` only; an explicit actor argument there is for audit attribution, never authorization. owner T20-auth-rls | verify: lint test + CI grep of `.next/static` for secret env names / `sb_secret_` [208 secret leakage]
- SEC-008 — Server-side paging caps inside every list/search function (people 20, admin lists ≤ 100); caller `limit`/`Range` above cap ignored; PostgREST `max_rows` ≤ 200. owner T33-people, T31-discovery-queries, T30/T34 admin lists | verify: direct RPC with `limit=1000` → ≤ cap [208 BOLA/IDOR]

### Ownership (BOLA/IDOR, mass assignment)
- SEC-010 — Every read/command enforces ownership: request→buyer; registration→titular (buyer sees only context of own request); pass→titular, buyer only for GUEST passes; guest→owner; guardian assignment→guardian/minor; friendship→parties; reminders/preferences→recipient. Foreign ids → 404 (no existence oracle). owner T34-registration-passes, T33-people, T35-communications, T20 helpers | verify: two-user swap tests for every `:id` route and every public function [205 authenticated A/B; 208 BOLA/IDOR]
- SEC-011 — Friend QR secrecy: render-qr only for titular runner or buyer-of-GUEST; FREE/confirm responses, request projections, buyer summaries and idempotency replays never contain token, ciphertext, `token_hash` or a render handle for another participant. owner T34, T35 | verify: buyer render-qr on Friend pass → 404; scan `infra.idempotency_record.response_body` and `communication_message.render_context_snapshot` for `RN1.` → none [205 "no secret QR de Friend"; 208 QR]
- SEC-012 — Buyer-visible Friend/Guest projection = display_name, modality, category label, status (Guest: buyer-owned data only); never DOB/age, phone, emergency, guardian, raw `eligibility_snapshot`. owner T34 | verify: projection key snapshot test [208 BOLA/IDOR]
- SEC-013 — Legal acceptance recorded only for the caller (or an ACTIVE guardian for a minor); confirm blocked until each adult Friend's own acceptance exists. owner T34 | verify: direct RPC with acceptances for a Friend → `LEGAL_ACCEPTANCE_REQUIRED` [208 privilege escalation]
- SEC-014 — GuardianAssignment over a minor RunnerProfile becomes ACTIVE only after the minor's own authenticated acceptance plus in-person verification per event; guardian sees no minor QR/PII beyond need [H: §20 activation undefined]. owner T33 | verify: unrelated adult assigns minor → stays PENDING, no data access [208 BOLA/IDOR]
- SEC-015 — Friendship: accept/reject addressee only; remove either party; unordered-pair uniqueness; banned/locked profiles excluded; ACCEPTED re-checked at request confirm time. owner T33 | verify: pgTAP transition matrix [205 Friendship rows]
- SEC-016 — Mass assignment: `PATCH /me/profile` zod `.strict()` allowlist = phone + emergency fields (§160); `full_name`, `auth_user_id`, `account_state`, `profile_readiness`, DOB-after-READY only via staff commands with audit; column privileges match. Same for `PATCH /me/guests/:id` (no owner change). owner T33 | verify: PATCH with forbidden fields → 400 and DB unchanged, also via direct RPC [208 privilege escalation]

### Staff scope and RBAC
- SEC-020 — Scope derived from the target: each staff command resolves `edition_id` from the target row (registration→edition, pass→registration→edition, route→edition) and checks `private.has_staff_role(role, that_edition)`; client `edition_id` is only a consistency check (mismatch → 404). `has_staff_role` with NULL edition never matches EDITION-scoped rows; requires `staff_member.status='ACTIVE'` and `revoked_at is null`. owner T20 (helper) + T30-events-admin, T34, T40-raceday, T41-attendance-closure-credits | verify: Edition-A staff calls every admin endpoint with Edition-B resource ids and with mixed path/body ids → 404/403; pgTAP NULL-edition case [208 role scope]
- SEC-021 — Role management ADMIN GLOBAL only (EDITION ADMIN creates no assignment in V1); no self-grant; cannot revoke the last global admin; first admin created only by a SalvaOps/SYSTEM migration step, never a public function; roles read live from `app.staff_role_assignment` every call. owner T20 | verify: pgTAP escalation attempts; revoked staff with still-valid JWT → 403 on next request [208 privilege escalation, role scope]
- SEC-022 — Master §145 encoded once as `private.permission(role, action)` data; CHECKIN: no capacity/price/export/ban; OPERATOR: no ban/global grants/PII export without explicit permission; MODERATOR: queue shows photo + display name only. owner T20 | verify: pgTAP enumerates role × action from §145 [205 CHECKIN/MODERATOR/OPERATOR/ADMIN rows]
- SEC-023 — PII export needs explicit `EXPORT_PII` permission (ADMIN GLOBAL or explicit grant) + reason; audit row with filters and row count; `Cache-Control: no-store`, `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`; minimal default columns. owner T34 | verify: OPERATOR without permission → 403; audit row asserted [205 CHECKIN no export; 208 role scope]
- SEC-024 — CHECKIN manual lookup: ≥ 3 chars, Edition-scoped, returns name + registration_number + modality + guardian state only, rate-limited per staff, each query audited. owner T40 | verify: integration field allowlist + 429 [205 CHECKIN]
- SEC-025 — CSV/formula injection: cells starting `= + - @ \t \r` (and full-width ＝＋－＠) prefixed with an apostrophe; all fields quoted; UTF-8 BOM. owner T34 | verify: export fixtures `=HYPERLINK("http://x","y")`, `@SUM(1)`, `+cmd|' /C calc'!A0` inert [208 CSV/formula injection]

### QR credentials
- SEC-030 — No user-callable function accepts credential material. Option A (preferred, atomic with §74/§83): DB generates `extensions.gen_random_bytes(32)`, computes `token_hash`, stores `pgp_pub_encrypt(token, public_key)`; only the Next server holds the private key for rendering. Option B: user-facing commands create the pass without an ACTIVE credential; a `service_role`-only `private.issue_pass_credential(pass_id, hash, ciphertext, key_version)` (only when no ACTIVE credential exists) is called server-side post-commit with outbox retry; render issues lazily. owner T34 (decision: orchestrator/architect) | verify: catalog test — no `authenticated`-callable function has params matching `token|hash|cipher|key_version`; buyer direct RPC cannot set a Friend credential [208 QR replay, credential replacement]
- SEC-031 — Scan: token only in POST body; strict `^RN1\.[A-Za-z0-9_-]{43}$` before hashing; lookup ACTIVE credential by `token_hash`; lock pass row; §85 outcomes; `WRONG_EVENT` when pass Edition ≠ scan Edition; response shows display name + approved avatar for a visual identity check; `participant_pass_scan` never stores the token. owner T40 | verify: two stations, same token, concurrently → one VALID + one ALREADY_CHECKED_IN; replaced token → PASS_REPLACED; Edition-B token at A → WRONG_EVENT [208 QR replay]
- SEC-032 — Anti-guessing/bearer misuse: check-in rate-limited per staff/station with UNKNOWN_PASS burst alert; `public_code`/`registration_number` never authorize check-in; MANUAL_VERIFY requires staff lookup + reason + audit. owner T40 | verify: MANUAL_VERIFY without reason → 400; UNKNOWN_PASS burst → alert [208 QR brute-force]
- SEC-033 — Token confidentiality: plaintext only in memory during issue/render/scan; never in logs, Sentry, PostHog, audit, outbox, idempotency `response_body`, `render_context_snapshot`, URLs or Referer. Pass page and render response `private, no-store`, `Referrer-Policy: no-referrer`, excluded from PostHog replay/autocapture and Sentry replay; no service-worker caching. owner T34 + T43-taskcenter-observability + F-frontend | verify: E2E renders a pass, then greps captured logs, DB jsonb columns, Sentry/PostHog test transports for the token → 0 hits [208 secret leakage]
- SEC-034 — Crypto (if the ADR 8 AES path is kept): AES-256-GCM, random 96-bit IV per encryption, AAD = `RN1|<credential_id>|<key_version>`; after decrypt require `sha256(token) == token_hash` else fail closed + alert; key env values validated at boot (≥ 32 random bytes, decodable, distinct per env). owner T34 | verify: unit — tampered ct/IV/tag, row-swapped ciphertext, wrong key version → fail [208 encryption key handling]
- SEC-035 — Key lifecycle: issue with highest configured version; keep every version referenced by ACTIVE credentials; health check reports missing versions as booleans; rotation runbook add V(n+1) → deploy → optional re-encrypt worker → retire V(n) at zero references; compromise runbook = replace all ACTIVE credentials; restore test decrypts a sample (§196). owner T34 (+ orchestrator for secret ops) | verify: integration with V1+V2 configured renders both; V1 missing → health false, render fails closed [208 encryption key handling]
- SEC-036 — Replacement: pass row locked, old → REPLACED and new ACTIVE in one transaction, idempotent; titular self-service replacement rate-limited [H]. owner T34 | verify: §206 "replace dos veces / old QR rejected" [208 credential replacement]
- SEC-037 — Pass emails carry a link to the authenticated pass page, not the QR [H: if product requires the QR in mail, decrypt only inside the dispatch worker, never persist rendered HTML, accept mailbox exposure explicitly]. owner T35 (decision: orchestrator) | verify: rendered email fixtures contain no `RN1.` [208 secret leakage]

### Authentication and session
- SEC-040 — OTP-only: GoTrue `enable_confirmations = true`; a `before insert or update of encrypted_password on auth.users` trigger (or hook) rejects any non-empty password; `enable_manual_linking = false` (already [O]); identities auto-link only on verified email. owner T20 | verify: direct `POST /auth/v1/signup` with password → rejected; `PUT /auth/v1/user {password}` → rejected; pre-registration then victim OTP/Google → no shared account [208 privilege escalation, blocked signup]
- SEC-041 — GoTrue is the enforcing OTP control (Next route is additive): `otp_expiry = 600`, `otp_length = 6`, `max_frequency = "60s"`, `email_sent` sized under the Brevo quota, low `token_verifications`, CAPTCHA (Turnstile) in `[auth.captcha]` so direct GoTrue calls need a token; local `config.toml` and remote Auth config identical, checked by a drift script over a SalvaOps read. owner T20 (+ orchestrator for remote config) | verify: 2 direct OTP requests < 60 s → 429; code after 600 s → invalid; no captcha token → rejected; drift diff empty [208 rate limits]
- SEC-042 — Email quota guard: alert at 50/80 % of the daily Brevo quota; P3 campaigns and anonymous reminders stop at threshold to keep P0 OTP headroom; per-IP and per-email limits on `/api/v1/auth/otp`. owner T35 + T20 | verify: simulated threshold → P3 blocked, OTP still sent [208 rate limits]
- SEC-043 — Non-enumeration: `/api/v1/auth/otp` returns the same 202 body for new, existing, banned and blocked emails; hook rejection mapped to the same response. owner T20 | verify: response diff across the four cases [208 blocked signup]
- SEC-044 — Callback: PKCE only; `next` accepted only if, after a single decode, it starts with one `/` not followed by `/` or `\` and is in an internal route allowlist, else `/cuenta`; OTP verify is a server POST behind SEC-050. owner T20 | verify: `next=//evil.com`, `/\evil.com`, `https://evil.com`, `%2F%2Fevil.com`, `javascript:` → default redirect [208 CSRF where relevant]
- SEC-045 — Redirect allowlists exact per Auth project: prod = `https://runiismty.com/auth/callback` only; staging project = staging URL; no wildcards; deploy previews never use the prod Auth project; `site_url` per env. owner T20 + orchestrator | verify: SalvaOps read of Auth config == expected list [208 privilege escalation]
- SEC-046 — Ban/lock mid-session: every command and RLS helper checks live `account_state` and sanctions (never JWT claims); ban also sets GoTrue ban and revokes refresh sessions via SYSTEM; passes revoked per §121; profile/ranking caches invalidated (SEC-053). owner T36-avatar-sanctions (+T20 helpers) | verify: user with valid JWT banned → next mutation `ACCOUNT_BANNED`, render-qr denied, absent from people search, refresh fails [208 ban mid-session; 205 BANNED]
- SEC-047 — Blocked identity: `private.hook_before_user_created` matches normalized email (lowercase/trim; alias policy documented) and Google `sub`; hook error = reject (fail closed); onboarding and every READY transition re-check; remote enablement is a Gate-8 blocker. owner T36 + T20 (remote: orchestrator) | verify: pgTAP hook with blocked email/sub → reject; local signup rejected [208 blocked signup]
- SEC-048 — Identity sourcing: server identity from `getClaims()`/`getUser()` only; never `getSession()` alone; `user_metadata` never used for authorization, `full_name` or READY decisions; staff only from table. owner T20 | verify: lint bans `getSession(` outside the refresh path; `updateUser({data:{role:'ADMIN'}})` grants nothing [208 privilege escalation]
- SEC-049 — Cookies: no browser Supabase client (auth operations via route handlers) so `sb-*` cookies are `HttpOnly; Secure; SameSite=Lax; Path=/`, no `Domain`, `__Host-` prefix if the library allows [I: confirm @supabase/ssr supports this, else record the decision and rely on SEC-060]; refresh rotation on (local [O]); `jwt_expiry` ≤ 3600. owner T20 | verify: E2E `document.cookie` has no `sb-` token [208 XSS]

### CSRF, caching, headers, client sinks
- SEC-050 — CSRF: every non-GET `/api/v1/**` handler requires `Content-Type: application/json` and `Origin` (or `Sec-Fetch-Site: same-origin`) equal to the `APP_BASE_URL` origin; no CORS headers; no state change on GET/HEAD; server actions (if used) with exact `allowedOrigins`. Webhooks/workers exempt but secret-authenticated. owner T20 (guard) + all API tasks | verify: cross-origin POST with victim cookie → 403; `text/plain` → 415; route inventory has no mutating GET [208 CSRF]
- SEC-051 — No-store enforcement: handler wrapper sets `Cache-Control: private, no-store` for every authenticated/admin/scanner/onboarding/auth/inscripcion/cuenta response and `/api/v1/{me,admin,people,check-in,registration-requests}/**`; `netlify.toml` headers as backstop on the same prefixes. owner T20 + T31 | verify: on staging deploy, user A request then anon/user B → no A data; headers asserted; CDN cache status BYPASS/MISS [208 shared-cache privacy]
- SEC-052 — Cached pages are session-free: public/editorial routes never read cookies or render user chrome (hydrated client-side from `/api/v1/me`); no `'use cache'`/`unstable_cache` over user or staff data; responses carrying `Set-Cookie` never cacheable (apply the cache headers @supabase/ssr passes to `setAll`, if provided). owner T31 + F-frontend | verify: build report lists static/ISR routes, none reads auth; anon GET of cached pages never returns `Set-Cookie: sb-` [208 shared-cache privacy]
- SEC-053 — Privacy invalidation: AccountBanned / AvatarRemoved / visibility changes revalidate `profile:<publicId>`, `ranking`, affected `edition:*` (Netlify CDN purge); Cloudinary removal with `invalidate: true`; SLA ≤ 5 min. owner T36 + T31 | verify: ban → public profile 404 and removed avatar URL 404 within SLA [208 shared-cache privacy]
- SEC-060 — CSP: dynamic routes (auth/account/admin/scanner) nonce-based `script-src 'nonce-…' 'strict-dynamic'`; all routes `object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`; `connect-src`/`img-src` allowlists (self, PostHog, Sentry ingest, OpenFreeMap, Cloudinary); cached public pages without nonce accept only the minimum inline Next needs; CSP reporting on. owner F-frontend | verify: E2E header assertions; injected script in a content fixture does not run; no CSP reports during E2E [208 XSS]
- SEC-061 — Rich text/markdown (content blocks, legal docs): react-markdown (10.1.0 [O]) without `rehype-raw`/raw HTML; `urlTransform` allows `https:`, `mailto:`, `tel:`, relative only; images only from the Cloudinary allowlist; external links `rel="noopener noreferrer nofollow ugc"`; `dangerouslySetInnerHTML` banned except JSON-LD via `JSON.stringify` with `<` escaped as `<`; block payloads zod-validated per `block_type` on write. owner T30 (write validation) + F-frontend (render) | verify: fixtures `<img src=x onerror=…>`, `[x](javascript:…)`, `![t](https://evil/p.gif)`, `</script>` in JSON-LD → inert; ESLint `react/no-danger` = error [208 XSS, rich text sanitization]
- SEC-062 — Map sinks: MapLibre popups/labels use `setText`/`setDOMContent` with text nodes, never `setHTML` with route/POI/venue/GPX strings; style URL from config only. owner T32-routes-gpx + F-frontend | verify: POI named `<img src=x onerror=alert(1)>` renders as text [208 XSS]
- SEC-063 — Other sinks: `wa.me` URL = validated E.164 + `encodeURIComponent(message)`; every data-driven `href` scheme-validated; names rendered as text. owner F-frontend + T34 | verify: unit on URL builders [208 XSS]
- SEC-064 — Global headers: HSTS `max-age=31536000; includeSubDomains`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` (`no-referrer` on pass, auth callback, reminder-confirm), `Permissions-Policy` `camera=(self)` on `/scanner` only else `camera=()`, `geolocation=()`, frame-ancestors none. owner F-frontend | verify: header test per route class [208 XSS, secret leakage]
- SEC-065 — Image optimizer: `images.remotePatterns` / Netlify `remote_images` limited to the RUNIIS Cloudinary cloud path for approved/event media; no wildcard hosts. owner F-frontend | verify: `/_next/image?url=https://evil…` → 400 [SSRF, cf. SEC-150]
- SEC-066 — Authorization never in proxy or UI alone: proxy only refreshes the session; each handler calls `requireActor()`/`requireStaff(action, resource)` and the DB re-authorizes; `/admin`, `/scanner` server-guarded (`notFound()` for non-staff). owner T20 + F-frontend | verify: AST/grep test that every `app/api/v1/**` handler (except the public list) invokes a guard; runner/anon on `/admin` → 404 [208 privilege escalation; §230 hidden UI]

### Workers and cron
- SEC-070 — Internal workers: POST only; `Authorization: Bearer` compared with `crypto.timingSafeEqual` over SHA-256 digests; fail closed if the secret is unset or < 32 bytes; never in query strings; distinct per env; kick URLs built from `APP_BASE_URL` only (never `Host`, `X-Forwarded-Host`, `request.url`); responses carry counts only, `no-store`. owner T43 (framework) + each worker owner | verify: unit (unset secret, wrong secret, GET) → denied; request with `X-Forwarded-Host: evil` → kick target still APP_BASE_URL [208 secret leakage]
- SEC-071 — pg_cron jobs defined only in migrations, calling fixed `private.worker_*()`; `cron` schema not granted to API roles. owner T10 | verify: pgTAP `cron.job.command` ∈ allowlist [208 privilege escalation]
- SEC-072 — Outbox/domain-event payloads carry ids, never PII or tokens; consumers idempotent on `effect_key`. owner T10 + T35 | verify: payload schema test rejects PII keys [208 secret leakage]

### Email and webhooks
- SEC-080 — Brevo webhook: secret in a custom header (or Basic auth), never in the URL; constant-time compare; unauthenticated → 401, minimal `authenticated=false` record, no state change, rate-limited; body ≤ 64 KB, zod schema; dedupe key = provider event id or `sha256(message-id|event|ts_epoch)` under UNIQUE(provider, provider_event_id); monotonic per-message state; suppression-creating events accepted only for `provider_message_id`s RUNIIS sent; optional Brevo IP allowlist. owner T35 | verify: missing/wrong token, replayed body, complaint for an unknown message-id → no suppression; §206 duplicate/out-of-order [208 webhook authentication]
- SEC-081 — Email rendering auto-escapes all variables in HTML; text part plain; subject/display names stripped of CR/LF/control chars and length-capped; links only to `APP_BASE_URL`; no user data in From/Reply-To; DB templates are data (§132). owner T35 | verify: name `"<a href=//evil>x</a>\r\nBcc: x@y"` renders escaped/stripped [208 XSS]
- SEC-082 — Anonymous reminders: CAPTCHA + per-IP and per-email limits; function `service_role`-only (Next applies limits); confirmation token 32 random bytes, stored hashed, single-use, 24 h; the email link opens a page whose button POSTs (scanner GET prefetch cannot confirm consent); generic response regardless of state. owner T35 | verify: GET of confirm link → still PENDING; token reuse → 410; limit → 429 [208 rate limits]
- SEC-083 — `EMAIL_DELIVERY_MODE` fail-safe: unset/invalid → `capture` outside production and refuse-send in production; `allowlist` drops non-allowlisted recipients before the provider call; staging seeds synthetic only. owner T35 | verify: unit env matrix [208 secret leakage]
- SEC-084 — Unsubscribe/preference links: per-recipient random hashed token or HMAC; RFC 8058 one-click POST; cannot affect another recipient. owner T35 | verify: tampered token → 404 [208 BOLA/IDOR]

### Avatars (Cloudinary)
- SEC-090 — Pending privacy: signed uploads force `type=authenticated` (or `private`), `folder=runiis/<env>/avatar-pending`, server-generated random `public_id`; moderators view short-lived signed URLs of a stripped derived rendition; approval creates a new re-encoded asset with an unrelated random id in `avatar-approved`; Cloudinary strict transformations on; `fetch`/auto-upload delivery disabled. owner T36 (+ orchestrator for account settings) | verify: unsigned delivery URL of a pending asset → 401/404; approved URL unreachable before approval [208 avatar]
- SEC-091 — Upload contract: `upload-url` requires READY+ACTIVE and no AVATAR_UPLOAD_SUSPENSION, 5/day counted at issuance (committed); signature covers folder, public_id, type, timestamp, `allowed_formats=jpg,png,webp`, `overwrite=false`, incoming `c_limit` (e.g. 4096²); `submit` verifies via Admin API owner-bound public_id, format, `bytes ≤ 8 MB`, `width×height ≤ 40 MP`, else destroy + reject; output 512×512 WebP. owner T36 | verify: SVG/HTML renamed `.png`, polyglot, 30000×30000 PNG bomb, 9 MB file, reused signature → rejected, no public asset [208 avatar MIME spoof, image bomb]
- SEC-092 — EXIF/GPS: every served and moderator rendition comes from a metadata-dropping transformation (no `keep_iptc`/`keep_attribution` flags). owner T36 | verify: GPS-tagged fixture → derived file has no EXIF/GPS (exiftool) [208 EXIF/GPS removal]
- SEC-093 — Removal/ban: `CommunityProfile.avatar_asset_id` null, public object moved to non-public type or destroyed with `invalidate: true`, tags revalidated; retention copy only as authenticated type. owner T36 | verify: removed URL 404 within SLA [208 shared-cache privacy]

### GPX
- SEC-100 — GPX ingest (admin, server-side): ≤ 5 MB enforced while streaming; reject `<!DOCTYPE`/`<!ENTITY` before parsing; fast-xml-parser with `processEntities: false`, `htmlEntities: false`, `maxNestedTags` ≤ 20; ≤ 200k points; coordinate range checks; ≤ 10 s budget; never fetches URLs; outputs GeoJSON + length-capped control-char-free strings; always DRAFT (§170). owner T32 | verify: billion laughs, quadratic blowup, `SYSTEM` entity, 50 MB file, 10⁶ nested tags, NaN/out-of-range coords → fast 400 with bounded memory [208 malicious GPX/XML]
- SEC-101 — Parsed GPX mapped through a zod schema that drops unknown keys (incl. `__proto__`, `constructor`); POI name/desc stored as plain text; `<link href>` dropped or https-validated. owner T32 | verify: unit fixtures [208 XSS]

### Analytics, logs, errors
- SEC-110 — PostHog: identify only with a random analytics id (no email/name/auth id), none for minors; `person_profiles: 'identified_only'`; autocapture off or `data-ph` allowlist; no input capture; session replay off in V1 (else mask all text/inputs and block `/cuenta/**`, `/onboarding`, `/inscripcion/**`, `/admin/**`, `/scanner/**`, `/auth/**`); `before_send` strips query/fragment (`code`, `token`, `next`, `q`) and pass ids from `$current_url`, `$referrer`, `$pathname`; env tag. owner F-frontend + T43 | verify: E2E with PostHog test transport → no email/phone/DOB/`RN1.`/`code=`/`token=` [208 secret leakage]
- SEC-111 — Sentry + server logs: `sendDefaultPii: false`; no bodies/cookies/headers (`authorization`, `cookie`, `apikey`, `idempotency-key`, `x-runiis-gateway`); `beforeSend`/`beforeBreadcrumb` strip URL queries; replay off on authenticated routes; structured logs with allowlisted fields (request_id, route, status, code, duration, pseudonymous actor); zod errors logged without received values; PII never in GET RPC params. owner T43 | verify: forced error on onboarding with synthetic PII → Sentry test transport and captured logs contain none [208 secret leakage]
- SEC-112 — Audit log append-only (UPDATE/DELETE/TRUNCATE revoked + rejecting trigger); snapshots minimize PII (ids + changed fields) and never hold secrets; read = ADMIN GLOBAL (EDITION admin: own Edition). owner T10 + T43 | verify: pgTAP update/delete denied; CHECKIN select → 0 rows [208 privilege escalation]

### Minors
- SEC-120 — Ranking/achievement projections exclude credits whose participant was < 18 at `sport_date` (computed server-side from DOB); minor public profile/search result limited to what §19 allows (no age, no competitive fields); BIRTHDAY/marketing audiences exclude minors; no identified analytics for minors; guardian relation never public; minor searchability default [H]. owner T42-rankings-achievements + T33 + T35 | verify: pgTAP projection with a 17-year-old credit → excluded; campaign audience excludes minors [208 RLS allow/deny]

### Secrets and environments
- SEC-130 — Only `NEXT_PUBLIC_SUPABASE_URL`, publishable key, Cloudinary cloud name, PostHog key/host and Sentry DSN are `NEXT_PUBLIC_*`; everything else via `lib/server/env.ts` (`server-only`, zod-validated, fail fast); Netlify secret scanning stays on with no secret in `SECRETS_SCAN_OMIT_KEYS`; Netlify contexts: production vars only in `production`, staging branch → staging Supabase/Brevo/Cloudinary, deploy previews → no secret keys (or staging + capture); PASS keys, cron and webhook secrets distinct per env; `SENTRY_AUTH_TOKEN` build-only. owner T20 (env module) + orchestrator (Netlify scoping) | verify: CI grep of `.next/static` for server env names; SalvaOps per-context env report [208 secret leakage]
- SEC-131 — Rotation runbooks for Supabase secret key, Brevo API/SMTP, Cloudinary, cron, webhook and PASS keys (SEC-035), env-only (no code change); legacy broad provider tokens revoked. owner orchestrator | verify: runbook dry-run on staging [208 encryption key handling, secret leakage]

### Integrity / abuse
- SEC-140 — Idempotency: UNIQUE(actor_auth_user_id, operation_key, resource_scope, idempotency_key) `NULLS NOT DISTINCT` (PG17) or a SYSTEM sentinel actor; actor = `auth.uid()` inside the command; `request_hash` computed inside the command from canonical jsonb of its own arguments (handler hash advisory); key 16–128 chars `[A-Za-z0-9_-]`; replay re-authorizes and re-reads ownership; `response_body` never holds secrets (SEC-033); retention ≥ 24 h. owner T10 + T34 | verify: user B reuses A's key → independent execution, never A's response; same key + different body → 409; SYSTEM duplicate → one effect [208 idempotency cross-user collision]
- SEC-141 — Rate limits that count failures: `private.consume_rate_limit(bucket)` in its own committed call from Next before the command (unskippable via SEC-001) plus success-path counters inside commands; buckets per actor and per client IP (Netlify client-IP header, not client-supplied XFF) for anonymous endpoints; §179 values plus OTP per IP/email, anonymous reminder, check-in per station, render-qr per user, export per staff. owner T10 (infra) + T20 | verify: N+1 failing attempts (e.g. invalid friend requests) → 429 though each failed [208 rate limits]
- SEC-142 — Hold hoarding: per-Edition alert on PENDING requests from accounts < 24 h old; CAPTCHA on request creation for new/flagged accounts; staff bulk-cancel of PENDING; `active_holds` alert; stronger identity is a product decision [H]. owner T34 + T43 | verify: k6 with 50 fresh accounts → alert; bulk cancel releases capacity [208 rate limits]

### SSRF, supply chain, devices
- SEC-150 — No server fetch of user-supplied URLs in V1: GPX upload only; Cloudinary only via signed browser upload; content links never fetched/unfurled server-side; SEC-065; Sentry tunnel (if any) forwards only to the configured DSN host; SEC-070 kick URLs. Any URL-fetch feature needs AppSec review + egress allowlist. owner T30, T32, T36, F-frontend | verify: CI review gate flags `fetch(` with a non-constant URL under `lib/server`
- SEC-151 — `pnpm install --frozen-lockfile` in CI/Netlify; build-script allowlist minimal (currently `esbuild`, `unrs-resolver` [O]); `pnpm audit --prod` gate (high/critical blocks); PostHog/Sentry bundled from npm, no CDN `<script src>` (else SRI). owner orchestrator + F-frontend | verify: CI job
- SEC-160 — Scanner: staff session idle timeout on `/scanner`, explicit logout, no service-worker/offline caching of participant data, responses `no-store`, camera permission only there, `station_key` recorded. owner T40 | verify: after logout, back navigation shows no participant data; Cache Storage empty [208 secret leakage]

---

## 4. §208 traceability
| §208 item | SEC |
|---|---|
| RLS allow/deny | 002, 003, 010, 120 |
| BOLA/IDOR | 006, 008, 010, 011, 012, 014, 084 |
| privilege escalation | 001, 002, 004, 006, 013, 016, 021, 040, 045, 048, 066, 071, 112 |
| role scope | 020, 021, 022, 023 |
| secret leakage | 005, 007, 033, 037, 070, 072, 083, 110, 111, 130 |
| SQL injection | 006 (dynamic SQL rule), 005 |
| XSS / rich text sanitization | 049, 060, 061, 062, 063, 081, 101 |
| malicious GPX/XML | 100, 101 |
| avatar MIME spoof / image bomb / EXIF-GPS | 090, 091, 092 |
| QR brute-force / replay / credential replacement | 030, 031, 032, 036 |
| encryption key handling | 034, 035, 131 |
| idempotency cross-user collision | 140 |
| CSRF where relevant | 044, 050 |
| webhook authentication | 080 |
| rate limits | 041, 042, 082, 141, 142 |
| ban mid-session | 046 |
| blocked signup | 040, 043, 047 |
| shared-cache privacy | 051, 052, 053, 093 |
| CSV/formula injection | 025 |

Added beyond §208: open redirect (044), pre-account takeover (040), cron auth (070), analytics PII (110), minors (120), hold hoarding (142).

---

## 5. ADR-001 review (corrections)
- D2 × D8 — **Insecure (high).** Issuing commands take caller-supplied `(hash, ciphertext, key_version)` and are directly callable with a user JWT → buyer/operator controls other participants' QR secrets (T31). Correction: SEC-030 (Option A in-DB generation + public-key encryption, or Option B service_role-only issuance); if B, amend the §74/§83 atomicity note.
- D2 — **Gap (medium).** "Safe when called directly" is right, but D5 (handler `request_hash`), D7 (route-level OTP limit), D8 (handler credential material), D9 (in-transaction counters) and zod/Origin checks all assume Next mediation. Also unstated: Supabase default privileges auto-granting `public` functions to `anon`, extensions landing in `public` (PostGIS), `graphql_public` as a second surface, raw PostgREST error details. Correction: SEC-001..006 (pre-request gateway gate, default-privilege revoke + ACL allowlist test, `extensions` schema, drop pg_graphql, DB-side error sanitation). Consider splitting `private` into a data schema (no USAGE for API roles) and a callable-function schema.
- D4 — **Gap (low).** Raw constraint errors bypass `errors.ts` for direct callers. Correction: SEC-005.
- D5 — **Ambiguous (low).** `request_hash` from the handler is not bound to args; `actor_auth_user_id NULL` breaks SYSTEM uniqueness; replay may return stored secrets. Correction: SEC-140. Also add the CSRF/Origin policy for cookie-auth handlers (SEC-050) and the explicit no-store route list (SEC-051).
- D6 — **Gap (medium).** Silent on the browser client and cookie flags; JS-readable `sb-*` cookies turn any XSS into session theft. Correction: SEC-049 (no browser client, HttpOnly cookies if supported) + SEC-060; SEC-007 lint confinement of the secret client.
- D7 — **Insecure as configured (high) / ambiguous.** GoTrue is reachable directly, so `/api/v1/auth/otp` limits are advisory. Local config contradicts the ADR: `otp_expiry = 3600`, `max_frequency = "1s"`, `enable_confirmations = false` with password sign-up possible, hook section commented out [O `supabase/config.toml`]. Remote hook "outside SalvaOps capabilities" conflicts with the infra report's Auth Config read/write token scope. Correction: SEC-040, 041, 043, 047; GoTrue CAPTCHA; remote Auth config (hook, confirmations, OTP timings, redirects, captcha) as a named Gate-8 blocker with an owner.
- D8 — **Incomplete (medium).** No AAD, no post-decrypt hash check, no key-version lifecycle, no rule for QR in emails. Correction: SEC-033..035, 037.
- D9 — **Flawed (medium).** Counters consumed inside a transaction that raises are rolled back → failures uncounted; no IP dimension; OTP/anonymous reminders not covered. Correction: SEC-141, 082, 042.
- D10 — **Incomplete (medium).** Worker auth lacks fail-closed-on-unset, header-only, per-env secret, and a rule that kick URLs come from `APP_BASE_URL` (Host-header exfiltration of the secret). Correction: SEC-070.
- D11 — **Ambiguous (medium).** "Pending assets private" names no Cloudinary mechanism (folders are not access control) → SEC-090; `EMAIL_DELIVERY_MODE` has no fail-safe default → SEC-083; "PostHog no PII" omits replay/autocapture/URL tokens → SEC-110; no Sentry scrubbing rule → SEC-111.
- D12 — **Incomplete (medium).** Needs session-free cached pages, no `Set-Cookie` on cacheable responses, no `'use cache'` over user data, Cloudinary CDN invalidation on removal/ban. Correction: SEC-051..053, 093.
- D13 — OK; bundle isolation is not authorization (SEC-066). Add CSP/security headers (SEC-060, 064) and the image-optimizer allowlist (SEC-065).
- D1 — OK; enforce "no tables in `public`" by test (SEC-003) and audit append-only (SEC-112).
- D3, D14, D15 — no security objection.

## 6. Owner/product decisions needed
1. SEC-030 option A vs B (architect + orchestrator).
2. QR in pass emails vs link-only (SEC-037).
3. GuardianAssignment activation for minor RunnerProfiles (SEC-014).
4. Minor searchability default (SEC-120).
5. Titular self-service credential replacement (SEC-036).
6. Anti-sybil strength against hold hoarding (SEC-142).
7. Remote Auth config and PostgREST pre-request role setting via SalvaOps (SEC-001, 040, 041, 045, 047).

## 7. Snapshot of the concurrent T10 working tree (uncommitted, not audited; hints only)
Seen at review time, may change: extensions created `with schema extensions` (SEC-003 on track); default privileges revoked for `app/private/audit/infra` plus global PUBLIC EXECUTE revoke, but **no revoke of the `public`-schema defaults for `anon`/`authenticated`** and nothing on pg_graphql (SEC-002, 004 still open); worker bearer check is constant-time and rejects an empty secret, env module enforces ≥ 32-char secrets (SEC-070 mostly on track); CSRF helper uses Sec-Fetch-Site/Origin but no JSON content-type rule yet (SEC-050); `lib/server/crypto/pass-credential.ts` uses AES-256-GCM + HKDF with **no AAD** (SEC-034); no public command functions exist yet, so SEC-030 can still be adopted without rework.
