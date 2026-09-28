import type { Metadata } from "next";
import Link from "next/link";
import { Ticket } from "lucide-react";
import { requireReadyAccount, settle } from "@/app/cuenta/_lib/session";
import { AccountShell } from "@/components/shell/account-shell";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PassRow, PassSupportNote } from "@/components/account/pass-row";
import { RestrictedAccount } from "@/components/account/restricted-account";
import { AccountSection, RowList } from "@/components/account/section";
import { SectionError } from "@/components/account/section-error";
import { listMyPasses } from "@/lib/server/domain/passes/service";

export const metadata: Metadata = { title: "Pases" };

const TITLE = "Pases";

// J3: own passes first, then the Guest passes this buyer holds. Friends' passes never appear here
// (the server projection excludes them); there is no self-service replacement (staff-only, A3).
export default async function PassesPage() {
  const account = await requireReadyAccount("/cuenta/pases");
  if (account.restriction) {
    return (
      <AccountShell pageTitle={TITLE}>
        <RestrictedAccount restriction={account.restriction} />
      </AccountShell>
    );
  }
  const passes = await settle(listMyPasses(account.supabase));
  if (!passes.ok) {
    return (
      <AccountShell pageTitle={TITLE}>
        <SectionError code={passes.code} title="No pudimos cargar tus pases." />
      </AccountShell>
    );
  }

  const byDate = (a: (typeof passes.data)[number], b: (typeof passes.data)[number]) =>
    (a.edition.event_date ?? "9999").localeCompare(b.edition.event_date ?? "9999");
  const own = passes.data.filter((pass) => pass.participant.is_self).sort(byDate);
  const guests = passes.data.filter((pass) => !pass.participant.is_self).sort(byDate);

  return (
    <AccountShell pageTitle={TITLE}>
      {passes.data.length === 0 ? (
        <EmptyState
          icon={Ticket}
          headingLevel="h2"
          title="Aún no tienes pases"
          description="Cada participante recibe su pase cuando su inscripción se confirma."
          action={
            <Button asChild>
              <Link href="/eventos">Explorar carreras</Link>
            </Button>
          }
          className="rounded-card border border-divider bg-paper-raised"
        />
      ) : (
        <div className="flex flex-col gap-10">
          <p className="max-w-[var(--container-reading)] text-body text-ink-80">
            Muestra el código QR en el acceso del evento. Si no se puede escanear, el equipo puede usar el código público.
          </p>
          {own.length > 0 ? (
            <AccountSection id="mis-pases" title="Tus pases">
              <RowList label="Tus pases">
                {own.map((pass) => (
                  <PassRow key={pass.participant_pass_id} pass={pass} />
                ))}
              </RowList>
            </AccountSection>
          ) : null}
          {guests.length > 0 ? (
            <AccountSection id="pases-invitados" title="Pases de tus invitados" description="Los guardas tú: tus invitados no tienen cuenta.">
              <RowList label="Pases de tus invitados">
                {guests.map((pass) => (
                  <PassRow key={pass.participant_pass_id} pass={pass} />
                ))}
              </RowList>
            </AccountSection>
          ) : null}
          <PassSupportNote />
        </div>
      )}
    </AccountShell>
  );
}
