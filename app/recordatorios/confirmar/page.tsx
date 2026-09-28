import type { Metadata } from "next";
import { AuthFrame } from "@/components/account/auth-frame";
import { ReminderConfirm } from "@/components/account/reminder-confirm";

export const metadata: Metadata = {
  title: "Confirmar recordatorio",
  robots: { index: false, follow: false },
  // The token travels in this URL: never leak it to another origin through Referer.
  referrer: "no-referrer",
};

const TOKEN = /^[0-9a-f]{16,256}$/;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// Master §130/§176: the confirmation email links here; confirming is an explicit POST from this page
// (never a GET side effect, so link scanners cannot burn the token). Outcome copy is generic.
export default async function ConfirmReminderPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const token = typeof params.token === "string" && TOKEN.test(params.token) ? params.token : null;

  return (
    <AuthFrame title="Confirma tu recordatorio" lead="Un clic y te avisaremos por correo sobre esta carrera. No es una suscripción a noticias.">
      <ReminderConfirm token={token} />
    </AuthFrame>
  );
}
