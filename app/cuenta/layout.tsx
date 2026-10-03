import type { Metadata } from "next";
import type { ReactNode } from "react";
import { LegalBanner } from "@/components/account/legal-banner";
import { getMyLegalStatus } from "@/lib/server/domain/auth/service";
import { createSessionClient } from "@/lib/server/supabase/clients";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * Layout for /cuenta/*. Each page composes AccountShell with its own `pageTitle` and runs the server guard
 * (app/cuenta/_lib/session.ts) itself, so the redirect back from /entrar can carry that page's path. Pages read the
 * session cookie, so they always render per request.
 *
 * It also carries the OWN-05 banner: while the current TERMS_OF_SERVICE / PRIVACY_NOTICE version is not accepted
 * (first acceptance or a newer version) every account page says so. The read is advisory and fails open for the banner
 * only (anonymous, restricted or unreadable: no banner); the authority is the API/DB, which refuses registration without
 * acceptance (LEGAL_ACCEPTANCE_REQUIRED), and the registration flow has its own non-skippable gate.
 */
export default async function CuentaLayout({ children }: Readonly<{ children: ReactNode }>) {
  const legal = await getMyLegalStatus(await createSessionClient()).catch(() => null);
  return (
    <>
      {legal?.needs_acceptance ? <LegalBanner documents={legal.documents} reacceptance={legal.needs_reacceptance} /> : null}
      {children}
    </>
  );
}
