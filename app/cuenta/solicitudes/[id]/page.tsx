import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireReadyAccount, settle } from "@/app/cuenta/_lib/session";
import { AccountShell } from "@/components/shell/account-shell";
import { RequestDetail } from "@/components/account/request-detail";
import { RestrictedAccount } from "@/components/account/restricted-account";
import { SectionError } from "@/components/account/section-error";
import { getRegistrationRequest } from "@/lib/server/domain/registration/service";

export const metadata: Metadata = { title: "Detalle de solicitud" };

const TITLE = "Solicitud";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function RequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const account = await requireReadyAccount(`/cuenta/solicitudes/${encodeURIComponent(id)}`);
  if (account.restriction) {
    return (
      <AccountShell pageTitle={TITLE}>
        <RestrictedAccount restriction={account.restriction} />
      </AccountShell>
    );
  }
  // Someone else's (or a malformed) id is indistinguishable from a missing one (SEC-020).
  if (!UUID.test(id)) notFound();
  const request = await settle(getRegistrationRequest(account.supabase, id));
  if (!request.ok && (request.code === "NOT_FOUND" || request.code === "FORBIDDEN")) notFound();

  return (
    <AccountShell pageTitle={TITLE}>
      {request.ok ? <RequestDetail request={request.data} /> : <SectionError code={request.code} title="No pudimos cargar esta solicitud." />}
    </AccountShell>
  );
}
