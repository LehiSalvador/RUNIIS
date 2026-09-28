import type { Metadata } from "next";
import { requireReadyAccount, settle } from "@/app/cuenta/_lib/session";
import { AccountShell } from "@/components/shell/account-shell";
import { GuestsManager } from "@/components/account/guests-manager";
import { RestrictedAccount } from "@/components/account/restricted-account";
import { SectionError } from "@/components/account/section-error";
import { listMyGuests } from "@/lib/server/domain/people/service";

export const metadata: Metadata = { title: "Invitados" };

const TITLE = "Invitados";

export default async function GuestsPage() {
  const account = await requireReadyAccount("/cuenta/invitados");
  if (account.restriction) {
    return (
      <AccountShell pageTitle={TITLE}>
        <RestrictedAccount restriction={account.restriction} />
      </AccountShell>
    );
  }
  const [active, archived] = await Promise.all([
    settle(listMyGuests(account.supabase, "ACTIVE", undefined)),
    settle(listMyGuests(account.supabase, "ARCHIVED", undefined)),
  ]);

  return (
    <AccountShell pageTitle={TITLE}>
      <p className="mb-6 max-w-[var(--container-reading)] text-body text-ink-80">
        Personas sin cuenta que inscribes tú. Sus pases y correos llegan a tu cuenta; no tienen ranking ni amistades.
      </p>
      {active.ok && archived.ok ? (
        <GuestsManager initialActive={active.data} initialArchived={archived.data} />
      ) : (
        <SectionError code={!active.ok ? active.code : !archived.ok ? archived.code : "INTERNAL_ERROR"} title="No pudimos cargar tus invitados." />
      )}
    </AccountShell>
  );
}
