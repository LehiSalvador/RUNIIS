import type { Metadata } from "next";
import { requireReadyAccount, settle } from "@/app/cuenta/_lib/session";
import { AccountShell } from "@/components/shell/account-shell";
import { GuardiansManager } from "@/components/account/guardians-manager";
import { RestrictedAccount } from "@/components/account/restricted-account";
import { SectionError } from "@/components/account/section-error";
import { listMyFriendships, listMyGuardianAssignments, listMyGuests } from "@/lib/server/domain/people/service";

export const metadata: Metadata = { title: "Menores y tutores" };

const TITLE = "Menores y tutores";

export default async function GuardiansPage() {
  const account = await requireReadyAccount("/cuenta/menores");
  if (account.restriction) {
    return (
      <AccountShell pageTitle={TITLE}>
        <RestrictedAccount restriction={account.restriction} />
      </AccountShell>
    );
  }
  const { supabase, profile } = account;
  const [assignments, friends, guests] = await Promise.all([
    settle(listMyGuardianAssignments(supabase, true)),
    settle(listMyFriendships(supabase, "FRIENDS", undefined)),
    settle(listMyGuests(supabase, "ACTIVE", undefined)),
  ]);

  return (
    <AccountShell pageTitle={TITLE}>
      <p className="mb-6 max-w-[var(--container-reading)] text-body text-ink-80">
        Quien tiene entre 15 y 17 años necesita un adulto responsable para inscribirse. La vinculación queda activa
        cuando ambas partes la confirman; en cada evento el adulto también se verifica en persona.
      </p>
      {!assignments.ok ? (
        <SectionError code={assignments.code} title="No pudimos cargar tus vinculaciones." />
      ) : (
        <GuardiansManager
          assignments={assignments.data}
          friends={friends.ok ? friends.data.items.flatMap((friendship) => (friendship.counterpart ? [friendship.counterpart] : [])) : []}
          minorGuests={guests.ok ? guests.data.items.filter((guest) => guest.is_minor) : []}
          viewerIsMinor={profile.community?.competition_status === "MINOR_NONCOMPETITIVE"}
        />
      )}
    </AccountShell>
  );
}
