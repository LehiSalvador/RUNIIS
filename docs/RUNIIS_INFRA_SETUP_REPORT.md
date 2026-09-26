# RUNIIS infrastructure setup report

- Run ID: `aa5dac8b-3818-4a29-ad89-ae569b91b3b2`
- Reported: 2026-09-26 (America/Mexico_City)
- Workspace: `C:\PROYECTOS_CLAUDE\RUNIIS WEB`
- Repository: `https://github.com/LehiSalvador/RUNIIS.git`
- Production branch: `main`
- Development/staging branch: `staging`
- Result: `INFRA_SETUP_INCOMPLETE` — Netlify production/staging deploys, custom-domain TLS, production Supabase runtime migration, and Google OAuth production/provider/URLs are configured. Staging Google provider has a verified missing-secret defect; Brevo key creation is gated by phone verification; Cloudinary signed upload is gated by missing `create` permission. Credential cleanup and dependent smokes remain incomplete. No unverified capability is reported as complete.

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
| Google OAuth staging | Auth Platform RUNIIS configured; `RUNIIS Staging` Web client uses permanent staging origin and exact staging Supabase callback; provider enabled with staging Site URL and allowlist | VERIFIED |
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
| Brevo API/SMTP/webhook/sender | deferred | deferred |
| Cloudinary cloud/API credentials | yes | yes |
| App encryption and cron secrets | yes, unique staging values | yes, distinct production values |
| PostHog key/host | yes | yes |
| Sentry DSN/org/project | yes | yes |

Netlify production contains current production Supabase URL/publishable/server-key/ref values, Google production credentials, generated production-only pass-encryption and cron values, plus Cloudinary, PostHog, and Sentry destinations. Brevo destinations remain pending its account gate.

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
| Supabase staging public/server safe probe | PASS |
| Supabase production server safe probe | PASS |
| PostHog `infra_smoke_test`, `environment=staging` | PASS; visible in activity |
| Sentry staging test event | ACCEPTED by Sentry ingestion |
| Cloudinary signed upload + 512x512 WebP transform + cleanup | DEFERRED; authenticated Admin read returns 200, while independent signed upload returns 403 because current key lacks `create`; no asset retained and no key rotated |
| Brevo/Supabase SMTP OTP | NOT RUN; Brevo blocks API/SMTP key creation behind one-time phone verification |
| Google OAuth redirect/callback | Production configuration verified. Staging safe provider probe returns 400 `Unsupported provider: missing OAuth secret`; full browser smoke remains blocked until safe secret recovery/replacement |
| Netlify staging root/health smoke | PASS; public permanent URL returns 200 and health returns safe staging JSON |
| Netlify staging deployment | PASS; branch build deploys one Next route-handler function |
| Netlify production root/health smoke | PASS; production and `main` URLs return 200 and health returns safe production JSON |
| Production domain/TLS/www redirect | PASS; apex returns 200 over TLS and `www` returns HTTPS 301 to apex |

## Deferred and human-required

### HUMAN_REQUIRED-001

- Provider: Brevo
- URL/tab: `https://app.brevo.com/settings/keys/api`
- Reason: Brevo requires one-time phone verification before it unlocks first API/SMTP-key creation. No authorized RUNIIS phone value is available to enter, and no value will be inferred from a different service.
- Exact action: In the open Brevo modal, enter an authorized RUNIIS phone number and complete only Brevo's one-time verification. Do not add a card or select a paid plan.
- Expected result: API and SMTP key creation controls unlock.
- Already completed: Brevo Free onboarding, Gmail email verification, exact Vercel DNS records, and `runiismty.com` sender-domain authentication.
- Next automatic step: Create separately named API and SMTP keys, store them only in approved secret destinations, configure Custom SMTP for staging/production, then run staging OTP smoke.

### Deferred technical dependencies

- Production Supabase migration: current publishable and server keys were migrated directly from the authenticated production dashboard into Netlify production. The stale canonical-master value was not used and no production value was added to `.env.local`.
- Google OAuth: production client, provider, and exact URL configuration are verified. Staging's existing provider lacks an OAuth secret: a safe authorize probe returns 400 `Unsupported provider: missing OAuth secret`. The original client secret is unavailable after its one-time reveal; replacement must be created or recovered securely before full staging sign-in smoke.
- Cloudinary signed upload: authenticated Admin read returns 200, but a direct independently signed staging upload returns 403 `Request forbidden due to missing permissions (actions=[create])`. Root cause is current key permission, not signature, clock, or environment formatting. Required avatar folders exist; no asset was created and no key was rotated.
- PostHog project label: configured project ID is valid but provider label remains `Default project`, not `RUNIIS WEB`.
- Sentry: provider shows its included 14-day trial banner. No payment method or upgrade was accepted; verify Free-plan behavior without enabling billing.
- SalvaOps: no direct connector/index surface is available to this execution environment. No unsupported integration was fabricated.

### HUMAN_REQUIRED-002

- Provider: Netlify
- URL/tab: `https://app.netlify.com/teams/runiis/projects`
- Reason: an interrupted local CLI recovery created the empty duplicate project `deft-trifle-b68872` while the correct `runiis-web` link was temporarily unavailable. The provisioning safety policy forbids deleting cloud projects without a direct action-time authorization.
- Exact action: authorize deletion of that specific empty duplicate only.
- Expected result: only `runiis-web` remains in the RUNIIS Netlify team.
- Already completed: original `runiis-web` was restored as the local link; it remains the sole authorized Git-connected site.
- Next automatic step: delete the duplicate, verify project list, then continue deployment smoke.

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
- [x] Netlify site and staging deploy
- [x] Netlify public access
- [x] Netlify production deployment
- [ ] Netlify production environment context complete; Brevo provider values remain pending
- [x] Domain verification/TLS and HTTPS `www` redirect
- [x] Google production OAuth and production Auth URLs
- [ ] Google staging OAuth secret and end-to-end smoke
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

1. Recover or create a safely stored staging Google OAuth secret, set it in Supabase staging, then run sign-in smoke.
2. Complete the single Brevo phone gate, then API/SMTP, sender, Supabase SMTP, and OTP smoke.
3. Grant only Cloudinary `create` permission to the existing RUNIIS runtime key, rerun signed-upload/transform/cleanup smoke.
4. Complete credential cleanup only after every required destination and smoke is verified.
