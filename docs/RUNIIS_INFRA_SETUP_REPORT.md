# RUNIIS infrastructure setup report

- Run ID: `aa5dac8b-3818-4a29-ad89-ae569b91b3b2`
- Reported: 2026-09-26 (America/Mexico_City)
- Workspace: `C:\PROYECTOS_CLAUDE\RUNIIS WEB`
- Repository: `https://github.com/LehiSalvador/RUNIIS.git`
- Production branch: `main`
- Development/staging branch: `staging`
- Result: `INFRA_SETUP_INCOMPLETE` — critical hosting, email, OAuth, production-secret, and DNS dependencies remain deferred. No unverified capability is reported as complete.

## Verified

| Component | Evidence | Status |
| --- | --- | --- |
| Workspace and Git | Exact origin, `main` and `staging` branches; no tracked runtime secret | VERIFIED |
| Technical bootstrap | Next.js/TypeScript root and `/api/health` exist; lint, typecheck, 2 local tests, and production build passed | VERIFIED |
| Canonical specification | `RUNIIS_WEB_SYSTEM_MASTER_SPEC_V2.md` is indexed in `docs/`; Cloudinary is documented as V1 media provider | VERIFIED |
| Supabase staging | RUNIIS organization and project ref `brxdgvcfykmsqmhsvgxl`; local CLI linked only to staging; safe public/server probes passed | VERIFIED |
| Supabase production | RUNIIS project ref `mdzhsoeqagtwznybwtuy`; current dashboard server credential probe passed | VERIFIED |
| Netlify account | RUNIIS Free team using Gmail RUNIIS; no card or paid upgrade accepted | VERIFIED |
| Cloudinary account | Free account and cloud `ecikmiji`; named runtime key and staging variables stored locally, not in Git | VERIFIED (configuration) |
| PostHog | RUNIIS organization, US project ID `629435`; Product Analytics with autocapture and heatmaps disabled; `infra_smoke_test` visibly received | VERIFIED |
| Sentry | US RUNIIS organization and Next.js project `runiis-web`; DSN stored only in ignored staging env; test event accepted by ingestion | VERIFIED |
| Credential backup | Timestamped pre-infra backup exists outside repository | VERIFIED |

## Environment destinations

No values are recorded in this report.

| Variable group | Staging `.env.local` | Production hosting |
| --- | --- | --- |
| Supabase URL, publishable key, secret key, ref, database URL | yes | deferred: Netlify site absent |
| Google OAuth client ID/secret | deferred | deferred |
| Brevo API/SMTP/webhook/sender | deferred | deferred |
| Cloudinary cloud/API credentials | yes | deferred: Netlify site absent |
| App encryption and cron secrets | yes, unique staging values | deferred: Netlify site absent |
| PostHog key/host | yes | deferred: Netlify site absent |
| Sentry DSN/org/project | yes | deferred: Netlify site absent |

The versioned `.env.example` contains names only. `.env.local`, `.local-secrets/`, `.local-state/`, provider files, backups, and build output are ignored.

## Deploy and DNS

- Netlify GitHub App authorization is limited to `LehiSalvador/RUNIIS`.
- Netlify has no RUNIIS site yet. Repository import returned to the authorization callback on retry, so no site ID, branch-deploy URL, environment contexts, production deployment, or domain attachment exists.
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
| Netlify staging/production deployment | NOT RUN; site absent |

## Deferred and human-required

### HUMAN_REQUIRED-001

- Provider: Brevo
- URL/tab: `https://onboarding.brevo.com/account/register/complete-profile`
- Reason: Brevo requires a genuine organization postal address for anti-spam compliance. No authorized address is available in setup context.
- Exact action: Enter RUNIIS legal street address, postal code, city, and country, then select the Free plan.
- Expected result: Brevo dashboard opens without a paid plan.
- Already completed: Gmail-based account registration and RUNIIS profile details.
- Next automatic step: Create separated API/SMTP credentials, configure sender/domain DNS, set Supabase custom SMTP, and run OTP smoke.

### Deferred technical dependencies

- Netlify repository import/site creation: GitHub scope is already restricted to `LehiSalvador/RUNIIS`, but no repository selection completed. This blocks staging URL, deployments, Netlify production/staging variables, domain attachment, and Google OAuth callback registration.
- Google OAuth: Google Cloud project `runiis-web` exists, but OAuth clients must use exact Supabase callbacks plus stable staging/production origins.
- Supabase production secret migration: canonical master production key is stale; current dashboard credential passed a safe probe. No production secret was copied into local staging env or hosting.
- Cloudinary signed upload: provider returned 403 after local env repair. Existing credential was not rotated; provider-side authorization needs diagnosis before repeat.
- PostHog project label: configured project ID is valid but provider label remains `Default project`, not `RUNIIS WEB`.
- Sentry: provider shows its included 14-day trial banner. No payment method or upgrade was accepted; verify Free-plan behavior without enabling billing.
- SalvaOps: no direct connector/index surface is available to this execution environment. No unsupported integration was fabricated.

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
- [ ] Netlify site, staging deploy, production deploy, and environment contexts
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
