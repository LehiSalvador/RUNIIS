import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireReadyAccount, settle } from "@/app/cuenta/_lib/session";
import { AccountShell } from "@/components/shell/account-shell";
import { PassDetail } from "@/components/account/pass-detail";
import { RestrictedAccount } from "@/components/account/restricted-account";
import { SectionError } from "@/components/account/section-error";
import { getMyPass } from "@/lib/server/domain/passes/service";

export const metadata: Metadata = { title: "Pase" };

const TITLE = "Pase";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PassPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const account = await requireReadyAccount(`/cuenta/pases/${encodeURIComponent(id)}`);
  if (account.restriction) {
    return (
      <AccountShell pageTitle={TITLE}>
        <RestrictedAccount restriction={account.restriction} />
      </AccountShell>
    );
  }
  // A Friend's pass, someone else's or a malformed id: all the same not-found (SEC-020, Master §84).
  if (!UUID.test(id)) notFound();
  const pass = await settle(getMyPass(account.supabase, id));
  if (!pass.ok && (pass.code === "NOT_FOUND" || pass.code === "FORBIDDEN")) notFound();

  return (
    <AccountShell pageTitle={TITLE}>
      {pass.ok ? <PassDetail pass={pass.data} /> : <SectionError code={pass.code} title="No pudimos cargar este pase." />}
    </AccountShell>
  );
}
