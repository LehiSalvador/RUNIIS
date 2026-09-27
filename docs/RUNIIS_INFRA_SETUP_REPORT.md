# RUNIIS infrastructure setup report

- Run ID: `aa5dac8b-3818-4a29-ad89-ae569b91b3b2`
- Updated: 2026-09-26 (America/Mexico_City)
- Canonical workspace: `C:\PROYECTOS_CLAUDE\RUNIIIS WEB`
- Repository: `https://github.com/LehiSalvador/RUNIIS.git`
- Production branch: `main`; staging branch: `staging`
- Result: `INFRA_SETUP_PARTIAL` — infrastructure, runtime, hosting, and independent final checks verified. Scoped Supabase handoff-token creation remains deferred after three dashboard submission routes produced neither a token nor a provider error. No secret value appears here.

## Verified infrastructure

| Component | Evidence | Status |
| --- | --- | --- |
| Git repository | `origin` is `LehiSalvador/RUNIIS`; `main` and `staging` exist; tracked source migrated into canonical workspace | VERIFIED |
| Git secret history | `gitleaks --all --redact` scanned 19 commits. Sole finding: empty `.env.example` `GOOGLE_CLIENT_SECRET=` placeholder | VERIFIED |
| Bootstrap quality | pnpm frozen install, lint, typecheck, 2 tests, production build pass from canonical workspace | VERIFIED |
| Supabase staging | RUNIIS ref `brxdgvcfykmsqmhsvgxl`; local CLI remains staging-only | VERIFIED |
| Supabase production | RUNIIS ref `mdzhsoeqagtwznybwtuy`; safe runtime probe passed | VERIFIED |
| Netlify | Existing Free site `runiis-web` (`129537db-751a-4828-9651-3cd93fef4c37`) remains linked only to `LehiSalvador/RUNIIS` | VERIFIED |
| Deploys and domain | Permanent staging and production root/health return 200; apex TLS valid; `www` HTTPS redirects to apex | VERIFIED |
| Google OAuth | Existing staging/production clients retained. Production replacement secret stored privately, installed in Netlify production, saved in enabled Supabase provider | VERIFIED_CONFIGURATION |
| Brevo | Free onboarding, domain auth, SMTP staging/production, staging OTP delivery, and private machine values retained | VERIFIED |
| Cloudinary | Scoped runtime folder-manager role passes authenticated read, signed upload, 512x512 WebP, and cleanup. No smoke asset remains | VERIFIED |
| PostHog / Sentry | Existing project/event and project/ingestion smoke retained; no billing method added | VERIFIED |

## Private credential destinations

No credential value is stored in Git, docs, `.env.example`, or this report.

| Source | Purpose | Status |
| --- | --- | --- |
| `C:\Users\lehi1\OneDrive\Documentos\RUNIIS_AGENT_SECRETS.env` | Non-SalvaOps runtime credentials; distinct staging/production app secrets; excludes GitHub/Vercel/Supabase management tokens | VERIFIED |
| `C:\Users\lehi1\OneDrive\Documentos\RUNIIS_SALVAOPS_PROVIDER_ACCESS.env` | Owner manual handoff for GitHub, Vercel, Supabase tokens only | IN_PROGRESS |
| Netlify secure environment contexts | Individual runtime values only; production Supabase remains separate from local staging `.env.local` | VERIFIED |

### SalvaOps manual handoff

| Provider | Token | Scope / expiration | Private variable | Status |
| --- | --- | --- | --- | --- |
| GitHub | `RUNIIS SalvaOps` | Only `LehiSalvador/RUNIIS`; Metadata read, Contents read/write; no expiration | `GITHUB_ACCESS_TOKEN` | VERIFIED |
| Vercel | `RUNIIS SalvaOps` | `lehisalvador` / `lehisalvadors-projects`; Full Account required for DNS; no expiration | `VERCEL_ACCESS_TOKEN` | VERIFIED |
| Supabase | `RUNIIS SalvaOps` | RUNIIS staging + production only; Project Settings and Auth Config read/write; maximum date 2027-09-26 | `SUPABASE_ACCESS_TOKEN` | DEFERRED |

GitHub token verification returned authenticated identity and repository access. Vercel verification returned authenticated identity, team domain listing, and DNS record read for `runiismty.com`.

## Smoke evidence

- Production: `https://runiismty.com/` and `/api/health` return 200.
- Staging: `https://staging--runiis-web.netlify.app/` and `/api/health` return 200.
- `https://www.runiismty.com/` returns `301 Location: https://runiismty.com/`.
- Cloudinary: signed runtime upload PASS; 512x512 WebP PASS; cleanup PASS; test-prefix verification count zero.
- Brevo/Supabase SMTP OTP remains verified; no provider key rotated in this pass.
- Google provider has exact production callback and enabled status. Full browser sign-in remains application-flow validation, not infrastructure failure.

## Workspace correction

- Correction backup: `C:\Users\lehi1\OneDrive\Documentos\RUNIIS_WORKSPACE_CORRECTION_BACKUP_20260926-221732`.
- Credential-master backup: `RUNIIS_CREDENCIALES_MAESTRAS.backup-pre-workspace-correction-20260926-225509.txt` outside Git.
- Canonical SalvaOps metadata remains local and excluded through `.git/info/exclude`.
- Accidental workspace remains only until provider-access source is complete and final compare/deletion gate passes.

## Deferred final action

### DEFERRED-001

- Provider: Supabase.
- Page: `https://supabase.com/dashboard/account/tokens`.
- Task: create/recover scoped `RUNIIS SalvaOps` token.
- Prepared scope: RUNIIS, projects `runiis-web-prod` and `runiis-web-staging`; Project Settings and Auth Config read/write; expiry 2027-09-26.
- Result: three dashboard submission routes (two UI clicks, Playwright click, and keyboard activation) produced no token and no provider error. Existing `RUNIIS Codex Management` remains active through 2027-09-19, but its one-time value cannot be recovered.
- Direct dependencies: `SUPABASE_ACCESS_TOKEN` handoff, final source validation, accidental-workspace removal, completion declaration.
- Next automatic step: retry from fresh authenticated dashboard; verify both project refs; store only `SUPABASE_ACCESS_TOKEN` privately.

## Safety checklist

- [x] `.env.example` has empty values only.
- [x] `.env.local`, state, local secrets, provider files, credential masters, backups, Netlify/Vercel state, build output, and logs ignored.
- [x] Current tracked filename audit finds no credential or backup file.
- [x] No history rewrite or force-push: scan clean except safe placeholder.
- [x] No paid plan, card, upgrade, account recreation, or broad Cloudinary runtime role.
- [ ] Supabase SalvaOps token captured and verified — provider UI deferred after three non-creating submissions.
- [ ] Final accidental-workspace compare and removal.
