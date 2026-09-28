import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthFrame } from "@/components/account/auth-frame";
import { SignInForm } from "@/components/account/sign-in-form";
import { isGoogleSignInEnabled } from "@/app/entrar/_lib/google";
import { resolveActor } from "@/lib/server/auth/actor";
import { resolveNextPath } from "@/lib/server/auth/safe-redirect";
import { createSessionClient } from "@/lib/server/supabase/clients";

export const metadata: Metadata = {
  title: "Entrar",
  description: "Entra a RUNIIS con Google o con un código de un solo uso enviado a tu correo.",
  robots: { index: false, follow: false },
};

// Callback/OAuth failure codes (app/auth/callback, app/api/v1/auth/google). Unknown codes are ignored.
const CALLBACK_ERRORS: Record<string, string> = {
  auth_failed: "No pudimos completar el acceso con Google. Intenta de nuevo o entra con tu correo.",
  missing_code: "El acceso con Google se canceló o no terminó. Intenta de nuevo o entra con tu correo.",
  google_unavailable: "El acceso con Google no está disponible por ahora. Entra con tu correo.",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function EntrarPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const rawNext = typeof params.next === "string" ? params.next : null;
  const next = resolveNextPath(rawNext);
  const errorCode = typeof params.error === "string" ? params.error : null;

  const supabase = await createSessionClient();
  const actor = await resolveActor(supabase).catch(() => null);
  if (actor?.auth_user_id) {
    if (actor.account_state && actor.account_state !== "ACTIVE") redirect("/cuenta");
    redirect(actor.profile_readiness === "READY" ? next : `/onboarding?next=${encodeURIComponent(next)}`);
  }

  const googleEnabled = await isGoogleSignInEnabled();

  return (
    <AuthFrame
      title="Entra a RUNIIS"
      lead="Sin contraseñas: continúa con Google o te enviamos un código de 6 dígitos a tu correo."
      footer={
        <p>
          Consulta los{" "}
          <Link href="/legal/terminos" className="font-semibold text-ink underline underline-offset-4">
            Términos y condiciones
          </Link>{" "}
          y el{" "}
          <Link href="/legal/privacidad" className="font-semibold text-ink underline underline-offset-4">
            Aviso de privacidad
          </Link>
          .
        </p>
      }
    >
      <SignInForm
        next={next}
        returning={rawNext !== null}
        googleEnabled={googleEnabled}
        callbackError={errorCode ? (CALLBACK_ERRORS[errorCode] ?? null) : null}
      />
    </AuthFrame>
  );
}
