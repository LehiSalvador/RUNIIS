import type { Metadata } from "next";
import { requireReadyAccount, settle } from "@/app/cuenta/_lib/session";
import { AccountShell } from "@/components/shell/account-shell";
import { LegalReacceptance } from "@/components/account/legal-acceptance";
import { RestrictedAccount } from "@/components/account/restricted-account";
import { SectionError } from "@/components/account/section-error";
import { getMyLegalStatus } from "@/lib/server/domain/auth/service";
import { resolveNextPath } from "@/lib/server/auth/safe-redirect";

export const metadata: Metadata = { title: "Documentos legales" };

const TITLE = "Documentos legales";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// OWN-05: the account-area re-acceptance screen (TERMS_OF_SERVICE / PRIVACY_NOTICE). The account banner and the
// registration flow send people here (or to the same gate inline) whenever a version is not accepted.
export default async function LegalDocumentsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const next = resolveNextPath(typeof params.next === "string" ? params.next : null);
  const account = await requireReadyAccount("/cuenta/documentos");
  if (account.restriction) {
    return (
      <AccountShell pageTitle={TITLE}>
        <RestrictedAccount restriction={account.restriction} />
      </AccountShell>
    );
  }
  const legal = await settle(getMyLegalStatus(account.supabase));

  return (
    <AccountShell pageTitle={TITLE}>
      {legal.ok ? <LegalReacceptance initial={legal.data} next={next} /> : <SectionError code={legal.code} title="No pudimos cargar tus documentos legales." />}
    </AccountShell>
  );
}
