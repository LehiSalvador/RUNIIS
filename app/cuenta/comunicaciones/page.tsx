import type { Metadata } from "next";
import Link from "next/link";
import { requireReadyAccount, settle } from "@/app/cuenta/_lib/session";
import { AccountShell } from "@/components/shell/account-shell";
import { CommunicationPreferences } from "@/components/account/communication-preferences";
import { RestrictedAccount } from "@/components/account/restricted-account";
import { SectionError } from "@/components/account/section-error";
import { getMyCommunicationPreferences } from "@/lib/server/domain/communications/service";

export const metadata: Metadata = { title: "Comunicaciones" };

const TITLE = "Comunicaciones";

export default async function CommunicationsPage() {
  const account = await requireReadyAccount("/cuenta/comunicaciones");
  if (account.restriction) {
    return (
      <AccountShell pageTitle={TITLE}>
        <RestrictedAccount restriction={account.restriction} />
      </AccountShell>
    );
  }
  const preferences = await settle(getMyCommunicationPreferences(account.supabase));

  return (
    <AccountShell pageTitle={TITLE}>
      <div className="max-w-[var(--container-reading)]">
        <p className="mb-6 text-body text-ink-80">
          Tú decides qué correos opcionales recibes. Los correos de tus inscripciones y pases se envían siempre porque son
          parte del servicio. Tus carreras guardadas están en{" "}
          <Link href="/cuenta/favoritos" className="font-semibold text-ink underline underline-offset-4">
            Favoritos
          </Link>
          .
        </p>
        {preferences.ok ? (
          <CommunicationPreferences initial={preferences.data} />
        ) : (
          <SectionError code={preferences.code} title="No pudimos cargar tus preferencias." />
        )}
      </div>
    </AccountShell>
  );
}
