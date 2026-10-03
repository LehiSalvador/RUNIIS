# RUNIIS E2E (Playwright)

Three projects (`chromium-desktop` 1280x900, `chromium-mobile` 390x844, `chromium-tablet` 768x1024), two modes.
Nothing in this directory contains a secret; every credential comes from the environment of the process that runs
the suite.

## Local mode (default)

```
pnpm exec playwright test                      # all projects
pnpm exec playwright test --project=chromium-desktop tests/e2e/account
```

* `playwright.config.ts` reuses the dev server on `127.0.0.1:3100` or starts it (`next dev -p 3100`).
* Sign-in goes through the real local flow: `POST /api/v1/auth/otp` -> Mailpit (`:54624`) -> `POST /api/v1/auth/verify`.
* State the UI cannot create (registration requests, passes, account sanctions) is seeded with SQL into the local
  Docker DB (`supabase_db_RUNIIIS_WEB`); the Editions come from `supabase/seeds/**`.
* Integration tests and these specs share the local DB lock rules of `scripts/db.mjs`; do not run the suite while a
  `db:locked` task you do not own is running.

## Remote mode (Vercel Preview / staging)

Set `E2E_BASE_URL` and the suite targets that origin. Remote mode never starts a dev server, never reads the local
DB, and skips (with a printed reason) every spec that needs seeded Editions or local SQL.

| Variable | Required | Meaning |
| --- | --- | --- |
| `E2E_BASE_URL` | yes (switches the mode) | Target origin, e.g. `https://staging.runiismty.com`. `https` unless loopback. |
| `E2E_VERCEL_BYPASS` | if the target is behind Vercel Authentication | Automation-bypass secret, sent as `x-vercel-protection-bypass`. |
| `E2E_SUPABASE_URL` + `E2E_SUPABASE_SERVER_KEY` | to sign in (both or neither) | The target's Supabase URL and server (secret) key, used only to mint an OTP. |
| `E2E_EVENT_SLUG` | for event specs | Slug of an OPEN, published QA Edition on the target. Without it the event/home/library-with-events specs skip with `no fixture Edition`. |
| `E2E_RUN_ID` | no | `[a-z0-9]{3,24}`; part of the fixture email. Generated when unset. |
| `E2E_FIXTURE_LOG` | no | NDJSON file listing created fixture users. Default `.salvaops-agent-evidence/P2-A-e2e-harness-revalidation/fixtures-<run>.ndjson`. |
| `E2E_WORKERS` | no | Default 2 remotely (see rate limits). |

Run it (values injected into the process environment by whoever owns them; never written to a file):

```
E2E_BASE_URL=... E2E_VERCEL_BYPASS=... E2E_SUPABASE_URL=... E2E_SUPABASE_SERVER_KEY=... E2E_EVENT_SLUG=... \
  pnpm exec playwright test --project=chromium-desktop
```

### What remote mode does

* **Bypass header.** `extraHTTPHeaders` carries `x-vercel-protection-bypass` for the target. `support/fixtures.ts`
  (`context` fixture) and `support/bypass.ts` re-issue requests to any *other* origin without it, so map tiles or fonts
  never receive the secret. Traces and videos are off in remote mode; screenshots are page pixels only. The banner and
  fixture log print presence flags and ids, never values.
* **Sign-in without email.** `support/remote-auth.ts` creates (or reuses) the QA user with the admin API, asks
  `auth.admin.generateLink({ type: "magiclink" })` for the 6-digit `email_otp`, and verifies it through the app's own
  `POST /api/v1/auth/verify` (with an `Origin` header), so the context holds the real HttpOnly session cookies.
  No email is sent: the UI sign-in spec answers `POST /api/v1/auth/otp` with a browser-side `202` and types the
  admin-generated code. The hook refuses any address outside `qa.e2e.*@example.com`.
* **Footprint.** Fixture users are `qa.e2e.<run>-<label>-<rand>@example.com`. Every user created is appended to the
  fixture log and echoed once as `[e2e-fixture] {...}` (id, email, host; no secret). Specs only touch data owned by
  those users (their profile, guests, friendships between two fixture users, favourites). Nothing is deleted
  automatically: remove them by the `qa.e2e.` prefix or the ids in the log.
* **Rate limits.** `auth.verify.ip` allows 30 verifications per 10 minutes per client IP and cannot be reset remotely.
  A full 3-project run signs in more often than that, so run one project per invocation, keep `E2E_WORKERS` low, or let
  the helper wait: on a `429` it sleeps for `Retry-After` (capped at 90 s) up to 3 times.
* **Not covered remotely** (skipped with a reason): pending-request/expiry/pass specs and restricted-account specs
  (SQL-seeded), favourites/reminders (seeded Edition ids), the seeded event-state matrix and historical-slug spec.
  The fixture-event smoke in `revalidation/surfaces.spec.ts` covers the QA Edition named by `E2E_EVENT_SLUG`.

### Rehearsing remote mode locally

`E2E_BASE_URL=http://127.0.0.1:3100` is a valid remote target: the dev server is not started (start it yourself), the
local DB stays available, and with `E2E_SUPABASE_*` pointing at the local stack the admin-OTP path is exercised
end-to-end. Bypass is accepted on loopback too, which is how the header plumbing is checked.

## Participant journeys (`journeys/**`, P2-E)

The Roadmap 8.22 journeys run end to end through `/inscripcion/[slug]`, onboarding, the account and the pass views:
Adult FREE, Adult WhatsApp (pending, `wa.me`, server countdown, cancel), Friend (FREE and WhatsApp), Guest (with the
per-participant event documents), Minor 15-17 with a guardian, minor without a guardian / under 15, Expired hold, Last slot race
(FREE and WhatsApp), Invalid form, Legal acceptance (onboarding and re-acceptance), Session recovery, Pass display, Credential
replacement, Communication preference, Mobile (390 px) and Keyboard-only. The matrix is in
`.salvaops-agent-evidence/P2-E-journey-e2e/journey-matrix.md`.

| Spec | Journeys |
| --- | --- |
| `journeys/adult.spec.ts` | Adult FREE, Adult WhatsApp, Invalid form |
| `journeys/people.spec.ts` | Friend (FREE, WhatsApp), Guest + per-participant documents, Minor with guardian, Minor without guardian / under 15 |
| `journeys/capacity.spec.ts` | Last slot race (WhatsApp, FREE), Expired hold (browser clock; server side, local only) |
| `journeys/session-legal.spec.ts` | Session recovery, Legal acceptance in onboarding, Legal re-acceptance (local only) |
| `journeys/pass.spec.ts` | Pass display, Credential replacement, Revoked pass (local only), Communication preference |
| `journeys/access.spec.ts` | Mobile (viewport pinned to 390x844 in every project), Keyboard-only |
| `journeys/plumbing.spec.ts` | Env plumbing self-test: fixture env, target guards, slug isolation. No app, no network, no secret. |

### Isolation: nothing registers into the owner-facing QA editions

Journeys never touch `qa-p2-gratis` / `qa-p2-whatsapp` (or any seeded edition). Each Playwright worker creates its own editions
through the **real admin API** (the same calls as `scripts/ops/staging-qa-fixtures.mjs`, whose `createIsolatedEdition` helper the
specs call; its staging-project / loopback guards are unchanged):

* names: `qa-e2e-<runId>-<project><worker><rand>-<key>`; keys `free` and `wa` (capacity 15 per modality, shared by the worker's
  journeys) and, created on demand, `racefree`, `racewa`, `expiredsrv` (capacity 1, so the race has exactly one winner).
  The assertion `assertIsolatedSlug` refuses anything else, including every `qa-p2-*` slug.
* users: the harness' fixture users (`qa.e2e.<runId>-<label>-<rand>@example.com` remotely, `f2-...@example.test` locally); every
  registration is made by users created by the run itself.
* teardown: when its worker ends, each worker **hides** the editions it created (`POST /admin/editions/{id}/hide`), so they leave
  every public surface. `E2E_KEEP_EDITIONS=1` keeps them for inspection. After a crashed run:
  `node scripts/ops/staging-qa-fixtures.mjs --hide-e2e-run=<runId>` (same env as the converge mode) hides what is left.
* log: every created and hidden edition is an NDJSON line (`kind: edition` / `edition_hidden`) in `E2E_FIXTURE_LOG`, next to the
  harness' user lines, and is echoed as `[e2e-fixture] {...}`. Ids and slugs only; no secret reaches a file, trace or report.
* admin identity comes only from the environment: `QA_ADMIN_EMAIL` (the staging GLOBAL ADMIN QA account) plus the server-key
  OTP mechanism (`E2E_SUPABASE_URL` + `E2E_SUPABASE_SERVER_KEY`). Without them the journeys `skip` with the reason printed.
  Locally the seed admin (`admin@runiis.test`) and the dev-env Supabase pair are used.

### Running the journeys

Local (the local stack; API sign-ins go through Mailpit, the UI sign-ins of the session and onboarding journeys use a server-side OTP because GoTrue sends one OTP email per address per 60 s; SQL levers allowed):

```
pnpm exec playwright test tests/e2e/journeys                     # three projects
pnpm exec playwright test --project=chromium-mobile tests/e2e/journeys/access.spec.ts
```

Remote (values injected into the process environment by whoever owns them; never written to a file):

```
E2E_BASE_URL=https://staging.runiismty.com E2E_VERCEL_BYPASS=... E2E_SUPABASE_URL=... E2E_SUPABASE_SERVER_KEY=... QA_ADMIN_EMAIL=... E2E_RUN_ID=p2e1 E2E_WORKERS=1 E2E_FIXTURE_LOG=.salvaops-agent-evidence/P2-E-journey-e2e/fixtures-p2e1.ndjson   pnpm exec playwright test --project=chromium-desktop tests/e2e/journeys
```

* One project per invocation, `E2E_WORKERS=1` (or 2): a project signs in about 30 times (every journey creates its own users,
  plus one admin session per worker) and `auth.verify.ip` allows 30 per 10 minutes per IP; the helper waits out a `429`.
* `E2E_EVENT_SLUG` is **not** used by the journeys (they create their own editions); it only matters for the older smoke specs.
* Remote runs skip, with the reason printed, only what needs the local DB: the revoked pass, the server-side expiry of a hold and
  the re-acceptance journeys (they rewrite one fixture user's rows in the local DB; publishing a new global legal version remotely
  would affect every staging user). The browser-clock expiry, the 24 h hold, the race, the credential replacement (staff through the
  admin API) and every other journey run remotely.
* Dry run of the plumbing without any secret: `pnpm exec playwright test --project=chromium-desktop tests/e2e/journeys/plumbing.spec.ts`.
* Local rehearsal of remote mode: `E2E_BASE_URL=http://127.0.0.1:3100` (or another loopback port; start the server yourself, with
  `APP_BASE_URL` set to the same origin because the harness' API sign-in sends an `Origin` header the app compares with it).

### What each journey proves (and how it stays off the owner's data)

* **Last slot race**: two buyers reach the review step on a capacity-1 edition, press submit together and exactly one gets `201`;
  the other gets `409 CAPACITY_UNAVAILABLE`, goes back to the details step with their answers kept, and sees the modality as
  "Temporalmente no disponible" (a hold) or "Agotado" (confirmed). Each buyer's own request list and, locally, the DB agree.
* **Expired hold**: the browser clock is fast-forwarded 24 h (Playwright `clock`), so the countdown, which is computed from the
  server's `expires_at` and `server_time`, flips by itself; locally the hold's columns are also moved in the DB and the next buyer
  takes the released place. The "countdown comes from the server" proof moves the device clock three days ahead and still reads about 24 h.
* **Friend**: FREE needs the Friend's own acceptance before submit: the buyer copies the deep link and the Friend accepts on
  `/cuenta/documentos/evento/{slug}` (P2-G2/G4; the guardian of a minor uses the same screen); WhatsApp lets the request exist,
  staff cannot confirm until the Friend accepts in `/cuenta`, and then can.
* **Credential replacement**: staff replace the credential through `POST /admin/passes/{id}/replace-credential`; the participant's
  view says the previous QR no longer works and the new render differs from the old one.

## Layout

| Path | Covers |
| --- | --- |
| `harness/plumbing.spec.ts` | Env resolution, bypass scoping (target-only), admin-OTP hook against a stand-in GoTrue API. Pure harness; no app involved. |
| `revalidation/aud-033.spec.ts` | AUD-033: anonymous `/cuenta/**` is a real 3xx to `/entrar?next=<path>`; signed-in unchanged. |
| `revalidation/google-oauth.spec.ts` | Google OAuth as a redirect chain only (start -> Supabase authorize -> Google; callback failures). |
| `revalidation/surfaces.spec.ts` | Roadmap 8.3 sweep: home, library, event, contact/about, legal, sign-in, onboarding, every account section. h1, overflow, console, axe (WCAG 2.2 AA). Writes `axe/*.json` evidence. |
| `public/**` | Home, library, event page, SEO files, static pages (environment-aware: non-production is not indexable, AUD-015). |
| `account/**` | Sign-in/OTP/onboarding, profile and states, friends, guests, guardians, requests, passes, favourites, communications. |
| `foundation/**` | Design system and shells. |
| `journeys/**` | Phase 2 participant journeys (Roadmap 8.22) on isolated per-run editions; see "Participant journeys" below. |
| `support/**` | `env.ts` (mode resolution), `remote-auth.ts`, `bypass.ts`, `targets.ts` (what a target offers), account/axe/fixtures helpers. |

Roadmap 8.3 mapping: Home, Event library, Event page, SEO -> `public/**` + `revalidation/surfaces`; Login/OTP/Onboarding ->
`account/sign-in` + `revalidation/surfaces`; Google OAuth -> `revalidation/google-oauth`; Cuenta, Friends, Guests, Guardian ->
`account/people`, `account/profile-and-states`, `revalidation/surfaces`; Requests page, Passes -> `account/requests-passes`
(local) + `revalidation/surfaces` (empty states, any target).
