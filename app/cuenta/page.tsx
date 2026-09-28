import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Inbox } from "lucide-react";
import { requireReadyAccount, settle } from "@/app/cuenta/_lib/session";
import { AccountShell } from "@/components/shell/account-shell";
import { Alert } from "@/components/ui/alert";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PassRow } from "@/components/account/pass-row";
import { PendingActionCard } from "@/components/account/pending-action-card";
import { RequestCard } from "@/components/account/request-card";
import { RestrictedAccount } from "@/components/account/restricted-account";
import { AccountSection, RowList } from "@/components/account/section";
import { SectionError } from "@/components/account/section-error";
import { SignOutButton } from "@/components/account/sign-out-button";
import { listMyPasses } from "@/lib/server/domain/passes/service";
import { listMyPendingActions, listMyRegistrationRequests } from "@/lib/server/domain/registration/service";
import { todayInBusinessZone } from "@/lib/client/person-fields";

export const metadata: Metadata = { title: "Mi cuenta" };

const TITLE = "Resumen";

export default async function AccountOverviewPage() {
  const account = await requireReadyAccount("/cuenta");
  if (account.restriction) {
    return (
      <AccountShell pageTitle={TITLE}>
        <RestrictedAccount restriction={account.restriction} />
      </AccountShell>
    );
  }
  const { supabase, profile } = account;

  const [actions, requests, passes] = await Promise.all([
    settle(listMyPendingActions(supabase, undefined)),
    settle(listMyRegistrationRequests(supabase, undefined, undefined)),
    settle(listMyPasses(supabase)),
  ]);

  const displayName = profile.community?.display_name ?? profile.full_name ?? "Corredor";
  const firstName = (profile.full_name ?? displayName).split(" ")[0];
  const pendingRequests = requests.ok ? requests.data.items.filter((request) => request.effective_status === "PENDING_CONFIRMATION") : [];
  const today = todayInBusinessZone();
  const upcomingPasses = passes.ok
    ? passes.data
        .filter((pass) => pass.status === "ACTIVE" && (pass.edition.event_date === null || pass.edition.event_date >= today))
        .sort((a, b) => (a.edition.event_date ?? "9999").localeCompare(b.edition.event_date ?? "9999"))
        .slice(0, 3)
    : [];
  const pendingActions = actions.ok ? actions.data.items : [];
  const nothingYet = requests.ok && passes.ok && requests.data.items.length === 0 && passes.data.length === 0;
  const isMinor = profile.community?.competition_status === "MINOR_NONCOMPETITIVE";

  return (
    <AccountShell pageTitle={TITLE}>
      <div className="flex flex-col gap-10">
        <div className="flex flex-col gap-5 rounded-panel border border-divider bg-paper-raised p-5 sm:flex-row sm:items-center sm:justify-between md:p-6">
          <div className="flex items-center gap-4">
            <Avatar displayName={displayName} size={64} decorative />
            <div className="min-w-0">
              <p className="font-display text-h3 font-bold text-ink">Hola, {firstName}</p>
              <p className="text-body-sm text-ink-60">
                Tu nombre público: <span className="font-semibold text-ink-80">{displayName}</span>
              </p>
            </div>
          </div>
          <SignOutButton className="w-full sm:w-auto" />
        </div>

        {isMinor ? (
          <Alert tone="info" title="Tienes un perfil de corredor menor de edad">
            No apareces en búsquedas ni rankings públicos. Para inscribirte necesitas un adulto responsable vinculado en{" "}
            <Link href="/cuenta/menores" className="font-semibold underline underline-offset-4">
              Menores y tutores
            </Link>
            .
          </Alert>
        ) : null}

        {!actions.ok ? <SectionError code={actions.code} title="No pudimos cargar tus pendientes." /> : null}
        {pendingActions.length > 0 ? (
          <AccountSection id="pendientes" title="Pendientes" description="Acciones que solo tú puedes completar.">
            <RowList label="Pendientes">
              {pendingActions.map((action) => (
                <PendingActionCard
                  key={`${action.edition.edition_id}-${action.subject.kind}-${"public_profile_id" in action.subject ? action.subject.public_profile_id : ""}${"guest_participant_id" in action.subject ? action.subject.guest_participant_id : ""}`}
                  action={action}
                />
              ))}
            </RowList>
          </AccountSection>
        ) : null}

        <AccountSection
          id="apartados"
          title="Solicitudes apartadas"
          description="El tiempo restante viene del servidor; al vencer, los lugares se liberan."
          action={
            <Link href="/cuenta/solicitudes" className="inline-flex min-h-11 items-center gap-1.5 text-button font-semibold text-ink underline decoration-divider underline-offset-8 hover:decoration-ink">
              Todas las solicitudes
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          }
        >
          {!requests.ok ? (
            <SectionError code={requests.code} title="No pudimos cargar tus solicitudes." />
          ) : pendingRequests.length > 0 ? (
            <div className="divide-y divide-divider rounded-card border border-divider bg-paper-raised">
              {pendingRequests.map((request) => (
                <RequestCard key={request.registration_request_id} request={request} />
              ))}
            </div>
          ) : (
            <p className="rounded-card border border-dashed border-divider px-5 py-4 text-body-sm text-ink-60">
              No tienes solicitudes pendientes de confirmar.
            </p>
          )}
        </AccountSection>

        <AccountSection
          id="proximos-pases"
          title="Próximos pases"
          action={
            <Link href="/cuenta/pases" className="inline-flex min-h-11 items-center gap-1.5 text-button font-semibold text-ink underline decoration-divider underline-offset-8 hover:decoration-ink">
              Todos los pases
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          }
        >
          {!passes.ok ? (
            <SectionError code={passes.code} title="No pudimos cargar tus pases." />
          ) : nothingYet ? (
            <EmptyState
              icon={Inbox}
              headingLevel="h3"
              title="Aún no tienes inscripciones"
              description="Cuando te inscribas a una carrera, aquí verás tu apartado y después tu pase."
              action={
                <Button asChild>
                  <Link href="/eventos">Explorar carreras</Link>
                </Button>
              }
              className="rounded-card border border-divider bg-paper-raised"
            />
          ) : upcomingPasses.length > 0 ? (
            <RowList label="Próximos pases">
              {upcomingPasses.map((pass) => (
                <PassRow key={pass.participant_pass_id} pass={pass} />
              ))}
            </RowList>
          ) : (
            <p className="rounded-card border border-dashed border-divider px-5 py-4 text-body-sm text-ink-60">
              No tienes pases para carreras próximas.
            </p>
          )}
        </AccountSection>
      </div>
    </AccountShell>
  );
}
