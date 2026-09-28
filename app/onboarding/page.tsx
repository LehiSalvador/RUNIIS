import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { loadLegalDocument } from "@/app/(public)/_lib/legal";
import { loadAccount } from "@/app/cuenta/_lib/session";
import { AuthFrame } from "@/components/account/auth-frame";
import { OnboardingForm, type PlatformLegalVersions } from "@/components/account/onboarding-form";
import { RestrictedAccount } from "@/components/account/restricted-account";
import { SignOutButton } from "@/components/account/sign-out-button";
import { resolveNextPath } from "@/lib/server/auth/safe-redirect";

export const metadata: Metadata = {
  title: "Completa tu perfil",
  robots: { index: false, follow: false },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// Master §16 / J8 step 4: one resumable form. Reopening always starts from what the profile already
// holds (GET-equivalent ensure_runner_profile), and a READY profile never sees this page again.
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

  const [terms, privacy] = await Promise.all([loadLegalDocument("terminos"), loadLegalDocument("privacidad")]);
  const legal: PlatformLegalVersions = {
    terms: terms.status === "published" ? terms.version : null,
    privacy: privacy.status === "published" ? privacy.version : null,
  };

  return (
    <AuthFrame
      title="Completa tu perfil"
      width="registration"
      lead="Te lo pedimos una sola vez. Con estos datos podrás inscribirte a carreras y registrar a tus invitados."
      headerAction={<SignOutButton variant="ghost" size="sm" />}
    >
      <OnboardingForm profile={account.profile} next={next} legal={legal} />
    </AuthFrame>
  );
}
