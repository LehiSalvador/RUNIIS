import type { Metadata } from "next";
import { requireReadyAccount, settle } from "@/app/cuenta/_lib/session";
import { AccountShell } from "@/components/shell/account-shell";
import { RequestsList } from "@/components/account/requests-list";
import { RestrictedAccount } from "@/components/account/restricted-account";
import { SectionError } from "@/components/account/section-error";
import { listMyRegistrationRequests } from "@/lib/server/domain/registration/service";

export const metadata: Metadata = { title: "Solicitudes" };

const TITLE = "Solicitudes";

export default async function RequestsPage() {
  const account = await requireReadyAccount("/cuenta/solicitudes");
  if (account.restriction) {
    return (
      <AccountShell pageTitle={TITLE}>
        <RestrictedAccount restriction={account.restriction} />
      </AccountShell>
    );
  }
  const requests = await settle(listMyRegistrationRequests(account.supabase, undefined, undefined));

  return (
    <AccountShell pageTitle={TITLE}>
      {requests.ok ? (
        <RequestsList initial={requests.data} />
      ) : (
        <SectionError code={requests.code} title="No pudimos cargar tus solicitudes." />
      )}
    </AccountShell>
  );
}
