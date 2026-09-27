# RUNIIS infrastructure setup report

- Run ID: `aa5dac8b-3818-4a29-ad89-ae569b91b3b2`
- Reported: 2026-09-26 (America/Mexico_City)
- Workspace: `C:\PROYECTOS_CLAUDE\RUNIIS WEB`
- Repository: `https://github.com/LehiSalvador/RUNIIS.git`
- Production branch: `main`
- Development/staging branch: `staging`
- Safe source commit verified in this pass: `f2aa3af`
- Result: `INFRA_SETUP_INCOMPLETE` — Netlify production/staging deploys, custom-domain TLS, production Supabase runtime migration, Google OAuth providers, Brevo Custom SMTP, and an OTP delivery smoke are configured and verified. Cloudinary signed upload remains gated by missing granular `create` permission. Credential cleanup and dependent smokes remain incomplete. No unverified capability is reported as complete.

## Verified

| Component | Evidence | Status |
| --- | --- | --- |
| Workspace and Git | Exact origin, `main` and `staging` branches; no tracked runtime secret | VERIFIED |
| Technical bootstrap | Next.js/TypeScript root and `/api/health` exist; lint, typecheck, 2 local tests, and production build passed | VERIFIED |
| Canonical specification | `RUNIIS_WEB_SYSTEM_MASTER_SPEC_V2.md` is indexed in `docs/`; Cloudinary is documented as V1 media provider | VERIFIED |
| Supabase staging | RUNIIS organization and project ref `brxdgvcfykmsqmhsvgxl`; local CLI linked only to staging; safe public/server probes passed | VERIFIED |
| Supabase production | RUNIIS project ref `mdzhsoeqagtwznybwtuy`; current dashboard server credential probe passed | VERIFIED |
| Netlify account | RUNIIS Free team using Gmail RUNIIS; no card or paid upgrade accepted | VERIFIED |
| Netlify site and Git source | Public site `runiis-web`, ID `129537db-751a-4828-9651-3cd93fef4c37`, linked only to `LehiSalvador/RUNIIS`; `main` and `staging` allowed | VERIFIED |
| Netlify deployments | Staging and production builds each publish one Next.js route-handler function; root and health smokes pass | VERIFIED |
| Production domain | `https://runiismty.com` serves valid TLS; `https://www.runiismty.com` returns HTTPS 301 to apex | VERIFIED |
| Google OAuth staging | Auth Platform RUNIIS configured; `RUNIIS Staging Active` client uses permanent staging/local origins and exact staging Supabase callback; credentials were saved in enabled staging provider | VERIFIED |
| Google OAuth production | `RUNIIS Production` Web client uses apex origin and exact production callback; Supabase production provider is enabled; Site URL is `https://runiismty.com` with explicit apex, permanent staging, and localhost redirect allowlist | VERIFIED |
| Cloudinary account | Free account and cloud `ecikmiji`; named runtime key and staging variables stored locally, not in Git | VERIFIED (configuration) |
| PostHog | RUNIIS organization, US project ID `629435`; Product Analytics with autocapture and heatmaps disabled; `infra_smoke_test` visibly received | VERIFIED |
| Sentry | US RUNIIS organization and Next.js project `runiis-web`; DSN stored only in ignored staging env; test event accepted by ingestion | VERIFIED |
| Credential backup | Timestamped pre-infra backup exists outside repository | VERIFIED |

## Environment destinations

No values are recorded in this report.

| Variable group | Staging `.env.local` | Production hosting |
| --- | --- | --- |
| Supabase URL, publishable key, secret key, ref, database URL | yes | URL, publishable key, secret key, and ref: yes; database migration URL not configured for runtime |
| Google OAuth client ID/secret | provider client ID is set; its secret must be recovered/replaced | yes; both values are secure in Netlify production |
| Brevo API/SMTP/webhook/sender | remote Supabase SMTP: yes; local ignored file is intentionally not populated through browser-secret isolation | yes; production and staging-branch contexts only, no Deploy Preview value |
| Cloudinary cloud/API credentials | yes | yes |
| App encryption and cron secrets | yes, unique staging values | yes, distinct production values |
| PostHog key/host | yes | yes |
| Sentry DSN/org/project | yes | yes |

Netlify production contains current production Supabase URL/publishable/server-key/ref values, Google production credentials, generated production-only pass-encryption and cron values, plus Cloudinary, PostHog, Sentry, and Brevo destinations. Brevo provider values are scoped to Production and Branch deploys; Deploy Previews receive none.

The versioned `.env.example` contains names only. `.env.local`, `.local-secrets/`, `.local-state/`, provider files, backups, and build output are ignored.

## Deploy and DNS

- Netlify GitHub App authorization is limited to `LehiSalvador/RUNIIS`. Official CLI recovery created the single Free site `runiis-web` (ID `129537db-751a-4828-9651-3cd93fef4c37`) and linked its source to only that repository.
- Netlify confirmed `runiis-web` is public. The official Next adapter was required because prior deploys published source/output without a route-handler function. The latest staging build now publishes one function and passes endpoint smoke.
- Remote production build `6ab84ea98a010da8b8a15c76` from commit `118a036` published successfully with one route-handler function. `runiis-web.netlify.app`, `main--runiis-web.netlify.app`, and their health endpoints return 200; health reports `production`.
- Netlify's source scan treated six nonsecret metadata values (application environment, public Cloudinary/Supabase identifiers, and Sentry organization/project identifiers) as matches because they are documented in source. `SECRETS_SCAN_OMIT_KEYS` was set for those nonsecret keys only. Runtime secrets remain scan-protected.
- Netlify domain binding is verified: `runiismty.com` is primary and `www.runiismty.com` redirects to it.
- `runiismty.com` remains Vercel-DNS-managed. Observed nameservers: `ns1.vercel-dns.com`, `ns2.vercel-dns.com`. Exact Netlify-required records were added without altering nameservers or email records: apex `A 75.2.60.5` and `www CNAME runiis-web.netlify.app` (TTL 60). Public recursive lookup now returns the Netlify apex and `www` CNAME; TLS is valid.

## Smoke results

| Smoke | Result |
| --- | --- |
| Local `/` and `/api/health` | PASS |
| Local quality gates | PASS: lint, typecheck, 2 tests, and production build rerun in final convergence |
| Supabase staging public/server safe probe | PASS |
| Supabase production server safe probe | PASS |
| PostHog `infra_smoke_test`, `environment=staging` | PASS; visible in activity |
| Sentry staging test event | ACCEPTED by Sentry ingestion |
| Cloudinary signed upload + 512x512 WebP transform + cleanup | DEFERRED; authenticated Admin read returns 200, while independent signed upload returns 403 because current key lacks `create`; no asset retained and no key rotated |
| Brevo/Supabase SMTP OTP | PASS; authenticated Supabase Management API read-back confirms Brevo host/port, sender, SMTP credentials present, and 10-minute OTP expiry for both project refs. Staging OTP request returned 200 and Brevo recorded delivery to Gmail RUNIIS. |
| Google OAuth redirect/callback | Production configuration verified. Staging active client with exact callback is saved in Supabase provider. Full browser sign-in smoke remains pending application login-flow validation. |
| Netlify staging root/health smoke | PASS; public permanent URL returns 200 and health returns safe staging JSON |
| Netlify staging deployment | PASS; branch build deploys one Next route-handler function |
| Netlify production root/health smoke | PASS; production and `main` URLs return 200 and health returns safe production JSON |
| Production domain/TLS/www redirect | PASS; apex returns 200 over TLS and `www` returns HTTPS 301 to apex |

## Deferred and human-required

### Brevo continuation

- Brevo one-time phone verification is complete. Separate named API and SMTP runtime keys were created in the existing Free account. Values are not recorded here.
- Custom SMTP was applied through the official Supabase Management API to staging and production, then read back successfully: `smtp-relay.brevo.com`, port 587, Gmail RUNIIS sender, credentials present, and 10-minute OTP expiry.
- A staging OTP request returned 200. Brevo Transactional Logs records delivered `Your sign-in link` mail to Gmail RUNIIS.
- Brevo API, SMTP, webhook, and sender variables are present by name in Netlify Production and Branch deploy contexts, with no Deploy Preview destination.
- Both seven-day Supabase provisioning tokens were deleted immediately after verification; the separate long-lived RUNIIS management token was preserved.
- Sender remains authorized Gmail RUNIIS for the technical smoke. DNS-authenticated `runiismty.com` remains available for a future product-mailbox sender cutover; no unverified mailbox address was invented.

### Deferred technical dependencies

- Production Supabase migration: current publishable and server keys were migrated directly from the authenticated production dashboard into Netlify production. The stale canonical-master value was not used and no production value was added to `.env.local`.
- Google OAuth: production client, provider, and exact URL configuration are verified. `RUNIIS Staging Active` supersedes original one-time-secret staging client and is saved in Supabase staging. Full browser sign-in smoke remains pending application login-flow validation.
- Cloudinary signed upload: authenticated Admin read returns 200, but a direct independently signed staging upload returns 403 `Request forbidden due to missing permissions (actions=[create])`. Root cause is current key permission, not signature, clock, or environment formatting. Cloudinary's Free console exposes only a broad Master Admin role or a controlled Media Library role for this key; folder-editor grants require its authenticated Admin API. Required avatar folders exist; no asset was created and no key was rotated.
- PostHog project label: configured project ID is valid but provider label remains `Default project`, not `RUNIIS WEB`.
- Sentry: provider shows its included 14-day trial banner. No payment method or upgrade was accepted; verify Free-plan behavior without enabling billing.
- SalvaOps: no direct connector/index surface is available to this execution environment. No unsupported integration was fabricated.

### Netlify cleanup

- Empty duplicate `deft-trifle-b68872` (ID `3d805189-b838-45a4-90b6-c223d746fcd0`) was deleted.
- Site list now contains only intended RUNIIS site `runiis-web` (ID `129537db-751a-4828-9651-3cd93fef4c37`).

## Credential handling

- Backup: `RUNIIS_CREDENCIALES_MAESTRAS.backup-pre-infra-20260925-180712.txt` exists outside Git and is retained.
- Cleanup: deferred. Runtime migrations must be verified in all intended destinations before removing any master-file value. No master credential was deleted or mass-rotated.
- Temporary Supabase tokens: both seven-day SMTP provisioning tokens were deleted after the verified configuration and OTP smoke. No token value is recorded here.
- Production secrets: not stored in `.env.local` and not committed.

## Checklist

- [x] Workspace correct
- [x] Repository correct; `main` and `staging` exist
- [x] No runtime secret tracked
- [x] Supabase staging and production refs verified
- [x] Staging CLI link is staging-only
- [x] Netlify Free account exists
- [x] Netlify site and staging deploy
- [x] Netlify public access
- [x] Netlify production deployment
- [x] Netlify production and staging-branch environment contexts include Brevo; no production Brevo values in Deploy Previews
- [x] Domain verification/TLS and HTTPS `www` redirect
- [x] Google production OAuth and production Auth URLs
- [x] Google staging OAuth client and provider; end-to-end browser sign-in remains application-flow validation
- [x] Brevo API/SMTP, sender/domain auth, Supabase SMTP, OTP smoke
- [x] Cloudinary Free account and staging variable destination
- [ ] Cloudinary signed-upload smoke
- [x] PostHog event smoke
- [x] Sentry project and ingestion smoke
- [x] `.env.example`, ignored staging `.env.local`, and state file
- [x] Credential backup
- [ ] Credential cleanup after verified migrations
- [x] This report

## Next automatic sequence

1. Grant only Cloudinary folder-editor/create permission to existing RUNIIS Runtime key, then rerun signed-upload/transform/cleanup smoke.
2. Run a future application-level Google sign-in flow after the product login UI exists; provider configuration is already verified.
3. Complete credential cleanup only after every required destination and smoke is verified.
