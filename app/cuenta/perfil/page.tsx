import type { Metadata } from "next";
import Link from "next/link";
import { requireReadyAccount } from "@/app/cuenta/_lib/session";
import { AccountShell } from "@/components/shell/account-shell";
import { Avatar } from "@/components/ui/avatar";
import { ProfileContactForm } from "@/components/account/profile-contact-form";
import { RestrictedAccount } from "@/components/account/restricted-account";
import { AccountSection, Fact } from "@/components/account/section";
import { formatCalendarDate } from "@/lib/client/account-format";
import { SEX_OPTIONS } from "@/lib/client/person-fields";

export const metadata: Metadata = { title: "Perfil" };

const TITLE = "Perfil";

const COMPETITION_LABELS: Record<string, string> = {
  ELIGIBLE: "Participa en rankings",
  MINOR_NONCOMPETITIVE: "Menor de edad: sin ranking público",
  SUSPENDED: "Ranking suspendido",
  INELIGIBLE: "Sin ranking",
};

export default async function ProfilePage() {
  const account = await requireReadyAccount("/cuenta/perfil");
  if (account.restriction) {
    return (
      <AccountShell pageTitle={TITLE}>
        <RestrictedAccount restriction={account.restriction} />
      </AccountShell>
    );
  }
  const { profile } = account;
  const displayName = profile.community?.display_name ?? profile.full_name ?? "";

  return (
    <AccountShell pageTitle={TITLE}>
      <div className="flex max-w-[var(--container-reading)] flex-col gap-10">
        <AccountSection
          id="identidad"
          title="Identidad"
          description="Estos datos validan tu inscripción y no se pueden cambiar desde tu cuenta."
        >
          <div className="rounded-card border border-divider bg-paper-raised p-5 md:p-6">
            <div className="flex items-center gap-4">
              <Avatar displayName={displayName} size={64} decorative />
              <div className="min-w-0">
                <p className="text-body-lg font-bold text-ink">{displayName}</p>
                <p className="text-body-sm text-ink-60">Nombre público en RUNIIS</p>
              </div>
            </div>
            <dl className="mt-6 grid gap-5 border-t border-divider pt-5 sm:grid-cols-2">
              <Fact label="Nombre completo">{profile.full_name}</Fact>
              <Fact label="Fecha de nacimiento">{formatCalendarDate(profile.date_of_birth, "long")}</Fact>
              <Fact label="Sexo">{SEX_OPTIONS.find((option) => option.value === profile.sex_code)?.label ?? "—"}</Fact>
              <Fact label="Participación">{COMPETITION_LABELS[profile.community?.competition_status ?? ""] ?? "—"}</Fact>
            </dl>
            <p className="mt-5 text-body-sm text-ink-60">
              ¿Hay un error en tu nombre o fecha de nacimiento?{" "}
              <Link href="/contacto" className="font-semibold text-ink underline underline-offset-4">
                Contacta a soporte
              </Link>
              .
            </p>
          </div>
        </AccountSection>

        <AccountSection
          id="contacto"
          title="Teléfono y emergencia"
          description="Puedes actualizarlos cuando quieras."
        >
          <ProfileContactForm
            initial={{
              phone_e164: profile.phone_e164,
              emergency_contact_name: profile.emergency_contact_name,
              emergency_contact_phone_e164: profile.emergency_contact_phone_e164,
              emergency_contact_relationship: profile.emergency_contact_relationship,
            }}
          />
        </AccountSection>
      </div>
    </AccountShell>
  );
}
