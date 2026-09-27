# RUNIIS infrastructure setup report

- Run ID: `aa5dac8b-3818-4a29-ad89-ae569b91b3b2`
- Updated: 2026-09-27 (America/Mexico_City)
- Result: `INFRA_SETUP_COMPLETE`
- Canonical workspace: `C:\PROYECTOS_CLAUDE\RUNIIIS WEB`
- Repository: `https://github.com/LehiSalvador/RUNIIS.git`
- Production branch: `main`; staging branch: `staging`

## Workspace and Git

| Item | Evidence | Status |
| --- | --- | --- |
| Canonical workspace | `C:\PROYECTOS_CLAUDE\RUNIIIS WEB` is working tree and SalvaOps-preserved workspace | VERIFIED |
| Accidental workspace | `C:\PROYECTOS_CLAUDE\RUNIIS WEB` removed after final unique-file comparison | VERIFIED |
| Correction backup | `C:\Users\lehi1\OneDrive\Documentos\RUNIIS_WORKSPACE_CORRECTION_BACKUP_20260926-221732` remains outside Git | VERIFIED |
| Git repository | Origin is `LehiSalvador/RUNIIS`; `main` and `staging` exist | VERIFIED |
| Secret scans | Current tree and all reachable history contain no real secret. Sole gitleaks match is empty `.env.example` placeholder `GOOGLE_CLIENT_SECRET=` | VERIFIED |

## Private credential sources

No credential value is stored in Git, docs, reports, `.env.example`, or this report.

| Source | Purpose | Status |
| --- | --- | --- |
| `C:\Users\lehi1\OneDrive\Documentos\RUNIIS_AGENT_SECRETS.env` | Non-SalvaOps provider credentials and application secrets only | VERIFIED |
| `C:\Users\lehi1\OneDrive\Documentos\RUNIIS_SALVAOPS_PROVIDER_ACCESS.env` | Owner manual handoff for GitHub, Vercel, and Supabase access tokens only | VERIFIED |
| Netlify secure environment contexts | Individual runtime secrets only; production Supabase remains separate from local staging configuration | VERIFIED |

`RUNIIS_AGENT_SECRETS.env` excludes `GITHUB_ACCESS_TOKEN`, `VERCEL_ACCESS_TOKEN`, and `SUPABASE_ACCESS_TOKEN`. The SalvaOps handoff source contains exactly those three variables.

### SalvaOps manual handoff

| Provider | Token | Resource scope / permissions | Expiration | Private variable | Status |
| --- | --- | --- | --- | --- | --- |
| GitHub | `RUNIIS SalvaOps` | Only `LehiSalvador/RUNIIS`; Metadata read, Contents read/write | No expiration | `GITHUB_ACCESS_TOKEN` | VERIFIED |
| Vercel | `RUNIIS SalvaOps` | Project only: `runiis-web` (`prj_8cMyzcQpzyJUd286AQ5DmpN2fHZE`) | No expiration | `VERCEL_ACCESS_TOKEN` | VERIFIED |
| Supabase | `RUNIIS SalvaOps` | RUNIIS only; `runiis-web-staging` and `runiis-web-prod`; Project Settings and Auth Config read/write | 2027-09-27 | `SUPABASE_ACCESS_TOKEN` | VERIFIED |

GitHub token authenticated as approved owner and accessed only RUNIIS. Vercel token accessed exact RUNIIS project and was denied access to unrelated project. Supabase token read approved staging and production project plus Auth configuration endpoints. Prior broad Vercel token and legacy Supabase token remain preserved because external dependency status cannot be disproven; new scoped handoff tokens are operational.

## Vercel resource binding

| Item | Value |
| --- | --- |
| Project role | SalvaOps resource binding / Git integration resource |
| Project | `runiis-web` |
| Project ID | `prj_8cMyzcQpzyJUd286AQ5DmpN2fHZE` |
| Team/account | `lehisalvadors-projects` / `lehisalvador` |
| Git repository | `LehiSalvador/RUNIIS` |
| Production branch | `main` |
| Generated technical URL | `https://runiis-web.vercel.app` |
| Production hosting authority | Netlify |
| Custom-domain authority | Existing Netlify deployment and DNS configuration |

Vercel Project has no `runiismty.com` domain assignment and received no copied Netlify runtime secrets.

## Verified infrastructure

| Component | Evidence | Status |
| --- | --- | --- |
| Supabase staging | RUNIIS ref `brxdgvcfykmsqmhsvgxl`; local CLI remains staging-only | VERIFIED |
| Supabase production | RUNIIS ref `mdzhsoeqagtwznybwtuy`; safe runtime probe passed | VERIFIED |
| Netlify | Free site `runiis-web` (`129537db-751a-4828-9651-3cd93fef4c37`) linked only to `LehiSalvador/RUNIIS` | VERIFIED |
| Netlify deploys/domain | Production and permanent staging root/health return 200; apex TLS valid; `www` redirects to apex | VERIFIED |
| Google OAuth | Existing staging/production clients and enabled Supabase providers retained with exact callbacks | VERIFIED_CONFIGURATION |
| Brevo | Free onboarding, domain auth, SMTP staging/production, and staging OTP delivery retained | VERIFIED |
| Cloudinary | Scoped runtime key: signed upload, 512x512 WebP, and test-asset cleanup passed final smoke | VERIFIED |
| PostHog | Existing project received `infra_smoke_test` | VERIFIED |
| Sentry | RUNIIS / `runiis-web` project accepted smoke event; no billing method added | VERIFIED |

## Final smoke and quality evidence

- Production: `https://runiismty.com/` and `/api/health` return 200.
- Staging: `https://staging--runiis-web.netlify.app/` and `/api/health` return 200.
- `https://www.runiismty.com/` redirects to `https://runiismty.com/`.
- Cloudinary: signed runtime upload PASS; 512x512 WebP PASS; cleanup PASS; no smoke asset remains.
- Brevo/Supabase SMTP OTP remains verified; no provider key rotated during final smoke.
- `pnpm run lint`, `pnpm run typecheck`, `pnpm test`, and `pnpm run build` pass from canonical workspace.

## Owner manual binding

SalvaOps internal connector automation is not available on this machine. Owner can open SalvaOps and copy three values from private handoff file into GitHub, Vercel, and Supabase bindings using these resource identities:

- GitHub repository: `LehiSalvador/RUNIIS`
- Vercel project: `runiis-web` / `prj_8cMyzcQpzyJUd286AQ5DmpN2fHZE`
- Supabase staging: `brxdgvcfykmsqmhsvgxl`; production: `mdzhsoeqagtwznybwtuy`

This is `OWNER_MANUAL_BINDING_READY`, not infrastructure blocker.
