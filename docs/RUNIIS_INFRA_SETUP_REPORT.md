# RUNIIS infrastructure setup report

- Run ID: `aa5dac8b-3818-4a29-ad89-ae569b91b3b2`
- Reported: 2026-09-26 (America/Mexico_City)
- Workspace: `C:\PROYECTOS_CLAUDE\RUNIIS WEB`
- Repository: `https://github.com/LehiSalvador/RUNIIS.git`
- Production branch: `main`
- Development/staging branch: `staging`
- Result: `INFRA_SETUP_INCOMPLETE` — Netlify hosting and Git source are now verified, including a production build. Public access, staging deployment, email, OAuth, production-secret migration, and DNS remain incomplete. No unverified capability is reported as complete.

## Verified

| Component | Evidence | Status |
| --- | --- | --- |
| Workspace and Git | Exact origin, `main` and `staging` branches; no tracked runtime secret | VERIFIED |
| Technical bootstrap | Next.js/TypeScript root and `/api/health` exist; lint, typecheck, 2 local tests, and production build passed | VERIFIED |
| Canonical specification | `RUNIIS_WEB_SYSTEM_MASTER_SPEC_V2.md` is indexed in `docs/`; Cloudinary is documented as V1 media provider | VERIFIED |
| Supabase staging | RUNIIS organization and project ref `brxdgvcfykmsqmhsvgxl`; local CLI linked only to staging; safe public/server probes passed | VERIFIED |
| Supabase production | RUNIIS project ref `mdzhsoeqagtwznybwtuy`; current dashboard server credential probe passed | VERIFIED |
| Netlify account | RUNIIS Free team using Gmail RUNIIS; no card or paid upgrade accepted | VERIFIED |
| Netlify site and Git source | Site `runiis-web`, ID `129537db-751a-4828-9651-3cd93fef4c37`, linked only to `LehiSalvador/RUNIIS`; `main` and `staging` allowed; Next.js production build from `40511d64ac34fac2dab13576fccea6f6fae5ad46` completed ready | VERIFIED (private access pending) |
| Cloudinary account | Free account and cloud `ecikmiji`; named runtime key and staging variables stored locally, not in Git | VERIFIED (configuration) |
| PostHog | RUNIIS organization, US project ID `629435`; Product Analytics with autocapture and heatmaps disabled; `infra_smoke_test` visibly received | VERIFIED |
| Sentry | US RUNIIS organization and Next.js project `runiis-web`; DSN stored only in ignored staging env; test event accepted by ingestion | VERIFIED |
| Credential backup | Timestamped pre-infra backup exists outside repository | VERIFIED |

## Environment destinations

No values are recorded in this report.

| Variable group | Staging `.env.local` | Production hosting |
| --- | --- | --- |
| Supabase URL, publishable key, secret key, ref, database URL | yes | deferred: Netlify site exists; production value migration remains pending |
| Google OAuth client ID/secret | deferred | deferred |
| Brevo API/SMTP/webhook/sender | deferred | deferred |
| Cloudinary cloud/API credentials | yes | deferred: Netlify site exists; production context migration remains pending |
| App encryption and cron secrets | yes, unique staging values | deferred: Netlify site exists; production context migration remains pending |
| PostHog key/host | yes | deferred: Netlify site exists; production context migration remains pending |
| Sentry DSN/org/project | yes | deferred: Netlify site exists; production context migration remains pending |

The versioned `.env.example` contains names only. `.env.local`, `.local-secrets/`, `.local-state/`, provider files, backups, and build output are ignored.

## Deploy and DNS

- Netlify GitHub App authorization is limited to `LehiSalvador/RUNIIS`. Official CLI recovery created the single Free site `runiis-web` (ID `129537db-751a-4828-9651-3cd93fef4c37`) and linked its source to only that repository.
- Production `main` build completed ready with Netlify Next.js detection at `https://runiis-web.netlify.app`. The site currently carries the Netlify team's Private access setting, so anonymous requests redirect to Edge Access and cannot yet pass public smoke.
- `runiismty.com` remains Vercel-DNS-managed. Observed nameservers: `ns1.vercel-dns.com`, `ns2.vercel-dns.com`. No records, MX, SPF, DKIM, DMARC, nameservers, or domain ownership were changed.
- Earlier lookup observed apex addresses `216.198.79.1` and `64.29.17.65`; `www` addresses `64.29.17.65` and `216.198.79.65`. This is inspection evidence only, not Netlify configuration.

## Smoke results

| Smoke | Result |
| --- | --- |
| Local `/` and `/api/health` | PASS |
| Supabase staging public/server safe probe | PASS |
| Supabase production server safe probe | PASS |
| PostHog `infra_smoke_test`, `environment=staging` | PASS; visible in activity |
| Sentry staging test event | ACCEPTED by Sentry ingestion |
| Cloudinary signed upload + 512x512 WebP transform + cleanup | DEFERRED; first attempt found malformed local env formatting, repaired; second provider attempt returned 403 and created no asset |
| Brevo/Supabase SMTP OTP | NOT RUN; Brevo onboarding incomplete |
| Google OAuth redirect/callback | NOT RUN; exact Netlify staging URL unavailable |
| Netlify production build | PASS; ready from `main` commit `40511d64ac34fac2dab13576fccea6f6fae5ad46` |
| Netlify public root/health smoke | BLOCKED; site is still marked Private in Netlify |
| Netlify staging deployment | NOT RUN; pending this staging documentation push |

## Deferred and human-required

### HUMAN_REQUIRED-001

- Provider: Brevo
- URL/tab: `https://onboarding.brevo.com/account/register/complete-profile`
- Reason: Brevo requires city and country in addition to the authorized address and postal code; it did not autocomplete either value.
- Exact action: Provide the authorized RUNIIS city and country for the already-filled address, then select the Free plan.
- Expected result: Brevo dashboard opens without a paid plan.
- Already completed: Gmail-based account registration, RUNIIS profile details, address, and postal code.
- Next automatic step: Create separated API/SMTP credentials, configure sender/domain DNS, set Supabase custom SMTP, and run OTP smoke.

### Deferred technical dependencies

- Netlify public access: the site is created and Git-connected, but Netlify marks it Private. Making this sole RUNIIS site public is required before public smoke, staging URL, custom-domain traffic, and DNS validation.
- Google OAuth: Google Cloud project `runiis-web` exists, but OAuth clients must use exact Supabase callbacks plus stable staging/production origins.
- Supabase production secret migration: canonical master production key is stale; current dashboard credential passed a safe probe. No production secret was copied into local staging env or hosting.
- Cloudinary signed upload: provider returned 403 after local env repair. The existing runtime key has the direct `Media Library User` role, but Cloudinary still denies its asset `create` action. Existing credential was not rotated; the exact capability needs adjustment before repeat.
- PostHog project label: configured project ID is valid but provider label remains `Default project`, not `RUNIIS WEB`.
- Sentry: provider shows its included 14-day trial banner. No payment method or upgrade was accepted; verify Free-plan behavior without enabling billing.
- SalvaOps: no direct connector/index surface is available to this execution environment. No unsupported integration was fabricated.

### HUMAN_REQUIRED-002

- Provider: Netlify
- URL/tab: `https://app.netlify.com/projects/runiis-web/overview`
- Reason: the Free team has marked this otherwise verified RUNIIS site Private.
- Exact action: use the visible **Make public** button for `runiis-web`.
- Expected result: public `runiis-web.netlify.app` reachability for smoke and domain traffic.
- Already completed: site creation, local link, restricted GitHub binding, branch binding, and ready production build.
- Next automatic step: verify public endpoints, deploy `staging`, then attach the production domain and exact DNS records.

## Credential handling

- Backup: `RUNIIS_CREDENCIALES_MAESTRAS.backup-pre-infra-20260925-180712.txt` exists outside Git and is retained.
- Cleanup: deferred. Runtime migrations must be verified in all intended destinations before removing any master-file value. No master credential was deleted or mass-rotated.
- Production secrets: not stored in `.env.local` and not committed.

## Checklist

- [x] Workspace correct
- [x] Repository correct; `main` and `staging` exist
- [x] No runtime secret tracked
- [x] Supabase staging and production refs verified
- [x] Staging CLI link is staging-only
- [x] Netlify Free account exists
- [x] Netlify site and production build
- [ ] Netlify public access, staging deploy, and environment contexts
- [ ] Domain connected to Netlify or pending correct Netlify DNS records
- [ ] Google OAuth clients and Supabase Auth URLs
- [ ] Brevo API/SMTP, sender/domain auth, Supabase SMTP, OTP smoke
- [x] Cloudinary Free account and staging variable destination
- [ ] Cloudinary signed-upload smoke
- [x] PostHog event smoke
- [x] Sentry project and ingestion smoke
- [x] `.env.example`, ignored staging `.env.local`, and state file
- [x] Credential backup
- [ ] Credential cleanup after verified migrations
- [x] This report

## Next automatic sequence

1. Complete Brevo postal-address step, then continue SMTP and OTP smoke.
2. Finish Netlify repo import for only `LehiSalvador/RUNIIS`, create site, deploy `staging`, then configure `main` production and exact Netlify DNS.
3. Register Google OAuth clients using resulting origins and Supabase callback URLs.
4. Set Netlify environment contexts, rerun production smokes, then complete credential cleanup.
