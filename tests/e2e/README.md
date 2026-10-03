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
| `support/**` | `env.ts` (mode resolution), `remote-auth.ts`, `bypass.ts`, `targets.ts` (what a target offers), account/axe/fixtures helpers. |

Roadmap 8.3 mapping: Home, Event library, Event page, SEO -> `public/**` + `revalidation/surfaces`; Login/OTP/Onboarding ->
`account/sign-in` + `revalidation/surfaces`; Google OAuth -> `revalidation/google-oauth`; Cuenta, Friends, Guests, Guardian ->
`account/people`, `account/profile-and-states`, `revalidation/surfaces`; Requests page, Passes -> `account/requests-passes`
(local) + `revalidation/surfaces` (empty states, any target).
