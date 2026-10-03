import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { settle, loadAccount } from "@/app/cuenta/_lib/session";
import { AuthFrame } from "@/components/account/auth-frame";
import { OnboardingForm } from "@/components/account/onboarding-form";
import { RestrictedAccount } from "@/components/account/restricted-account";
import { SectionError } from "@/components/account/section-error";
import { SignOutButton } from "@/components/account/sign-out-button";
import { resolveNextPath } from "@/lib/server/auth/safe-redirect";
import { getMyLegalStatus } from "@/lib/server/domain/auth/service";

export const metadata: Metadata = {
  title: "Completa tu perfil",
  robots: { index: false, follow: false },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// Master §16 / J8 step 4: one resumable form. Reopening always starts from what the profile already
// holds (GET-equivalent ensure_runner_profile), and a READY profile never sees this page again.
// OWN-05: the TERMS_OF_SERVICE / PRIVACY_NOTICE versions come from the account's own legal status (GET /me/legal), so the
// ids the form sends are exactly the versions shown. Without them the form cannot be submitted (fail closed, no invented text).
export default async function OnboardingPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const next = resolveNextPath(typeof params.next === "string" ? params.next : null);
  const account = await loadAccount("/cuenta");

  if (account.restriction) {
    return (
      <AuthFrame title="Tu cuenta" width="registration">
        <RestrictedAccount restriction={account.restriction} />
      </AuthFrame>
    );
  }
  if (account.profile.profile_readiness === "READY") redirect(next);

  const legal = await settle(getMyLegalStatus(account.supabase));

  return (
    <AuthFrame
      title="Completa tu perfil"
      width="registration"
      lead="Te lo pedimos una sola vez. Con estos datos podrás inscribirte a carreras y registrar a tus invitados."
      headerAction={<SignOutButton variant="ghost" size="sm" />}
    >
      {legal.ok ? (
        <OnboardingForm profile={account.profile} next={next} legal={legal.data.documents} />
      ) : (
        <SectionError code={legal.code} title="No pudimos cargar los documentos legales." />
      )}
    </AuthFrame>
  );
}
