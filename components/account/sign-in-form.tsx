"use client";

import React from "react";
import { ArrowLeft, Mail } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CountdownStatus } from "@/components/ui/countdown-status";
import { FormField, fieldDescribedBy } from "@/components/ui/form-field";
import { TextField } from "@/components/ui/text-field";
import { apiFetch } from "@/lib/client/api";
import { errorMessage, retryAfterSeconds } from "@/lib/client/account-errors";

/**
 * form spec 10.1 / J8: Email OTP (request -> 6-digit verify) plus the Google start link. The request
 * step always answers the same way (SEC-043), so the copy never says whether the email has an
 * account. Resend has a live 60 s cooldown; the code is valid 10 minutes.
 */
const RESEND_COOLDOWN_S = 60;
const CODE_TTL_MS = 10 * 60 * 1000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type MyProfileSummary = { profile_readiness: "PROFILE_INCOMPLETE" | "READY"; account_state: string };
type Notice = { tone: "danger" | "warning" | "info"; title: string; body?: string } | null;

export function SignInForm({
  next,
  returning,
  googleEnabled,
  callbackError,
}: {
  next: string;
  returning: boolean;
  googleEnabled: boolean;
  callbackError: string | null;
}) {
  const [step, setStep] = React.useState<"email" | "code">("email");
  const [email, setEmail] = React.useState("");
  const [emailError, setEmailError] = React.useState<string | undefined>();
  const [code, setCode] = React.useState("");
  const [codeError, setCodeError] = React.useState<string | undefined>();
  const [notice, setNotice] = React.useState<Notice>(callbackError ? { tone: "danger", title: callbackError } : null);
  const [requesting, setRequesting] = React.useState(false);
  const [verifying, setVerifying] = React.useState(false);
  const [sentAt, setSentAt] = React.useState<number | null>(null);
  const [cooldownUntil, setCooldownUntil] = React.useState<string | null>(null);
  const [redirecting, setRedirecting] = React.useState(false);
  const emailRef = React.useRef<HTMLInputElement>(null);
  const codeRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (step === "code") codeRef.current?.focus();
  }, [step, sentAt]);

  function startCooldown(seconds: number) {
    setCooldownUntil(new Date(Date.now() + seconds * 1000).toISOString());
  }

  async function requestCode(event?: React.FormEvent) {
    event?.preventDefault();
    if (requesting) return;
    const normalized = email.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(normalized)) {
      setEmailError("Escribe un correo válido, por ejemplo nombre@correo.com.");
      emailRef.current?.focus();
      return;
    }
    setEmailError(undefined);
    setNotice(null);
    setRequesting(true);
    const result = await apiFetch("/api/v1/auth/otp", { method: "POST", body: { email: normalized } });
    setRequesting(false);

    if (result.ok) {
      setSentAt(Date.now());
      setCode("");
      setCodeError(undefined);
      startCooldown(RESEND_COOLDOWN_S);
      setStep("code");
      return;
    }
    if (result.code === "VALIDATION_ERROR") {
      setEmailError("Escribe un correo válido, por ejemplo nombre@correo.com.");
      emailRef.current?.focus();
      return;
    }
    if (result.code === "RATE_LIMITED") {
      const wait = retryAfterSeconds(result) ?? RESEND_COOLDOWN_S;
      startCooldown(wait);
      setNotice({
        tone: "warning",
        title: "Ya pediste un código hace poco.",
        body: step === "email" ? "Si ya te llegó, úsalo. Podrás pedir otro cuando termine la espera." : undefined,
      });
      setSentAt((current) => current ?? Date.now());
      setStep("code");
      return;
    }
    setNotice({ tone: "danger", title: "No pudimos enviar el código.", body: errorMessage(result) });
  }

  async function verifyCode(event: React.FormEvent) {
    event.preventDefault();
    if (verifying || redirecting) return;
    if (!/^\d{6}$/.test(code)) {
      setCodeError("Escribe los 6 dígitos del código.");
      codeRef.current?.focus();
      return;
    }
    setCodeError(undefined);
    setNotice(null);
    setVerifying(true);
    const result = await apiFetch<MyProfileSummary>("/api/v1/auth/verify", {
      method: "POST",
      body: { email: email.trim().toLowerCase(), code },
    });

    if (result.ok) {
      setRedirecting(true);
      const profile = result.data;
      const destination =
        profile.account_state !== "ACTIVE"
          ? "/cuenta"
          : profile.profile_readiness === "READY"
            ? next
            : `/onboarding?next=${encodeURIComponent(next)}`;
      // Full navigation: every server component re-renders with the new HttpOnly session cookies.
      window.location.assign(destination);
      return;
    }

    setVerifying(false);
    setCode("");
    codeRef.current?.focus();
    if (result.code === "VALIDATION_ERROR") {
      const expired = sentAt !== null && Date.now() - sentAt > CODE_TTL_MS;
      if (expired) setCooldownUntil(null);
      setCodeError(
        expired ? "Este código expiró. Solicita uno nuevo." : "El código no es correcto o ya expiró. Revísalo e intenta de nuevo.",
      );
      return;
    }
    if (result.code === "RATE_LIMITED") {
      const minutes = Math.max(1, Math.ceil((retryAfterSeconds(result) ?? 600) / 60));
      setNotice({ tone: "warning", title: "Demasiados intentos.", body: `Espera ${minutes} min e intenta de nuevo.` });
      return;
    }
    if (result.code === "IDENTITY_LOCKED" || result.code === "ACCOUNT_BANNED" || result.code === "FORBIDDEN") {
      // J8 step 6: generic, never why.
      setNotice({ tone: "danger", title: "No podemos completar tu acceso.", body: "Contacta a soporte." });
      return;
    }
    setNotice({ tone: "danger", title: "No pudimos verificar el código.", body: errorMessage(result) });
  }

  function changeEmail() {
    setStep("email");
    setCode("");
    setCodeError(undefined);
    setNotice(null);
    requestAnimationFrame(() => emailRef.current?.focus());
  }

  const noticeBlock = notice ? (
    <Alert tone={notice.tone} title={notice.title} className="mb-6">
      {notice.body}
    </Alert>
  ) : null;

  if (step === "code") {
    const cooling = cooldownUntil !== null;
    return (
      <div>
        {noticeBlock}
        <div className="flex items-start gap-3">
          <Mail className="mt-0.5 size-5 shrink-0 text-ink-60" aria-hidden="true" />
          <p className="text-body text-ink-80" role="status">
            Enviamos un código de 6 dígitos a <span className="font-semibold text-ink [overflow-wrap:anywhere]">{email.trim().toLowerCase()}</span>.
            Vence en 10 minutos. Si no lo ves, revisa tu carpeta de spam.
          </p>
        </div>

        <form onSubmit={verifyCode} noValidate className="mt-6">
          <FormField id="otp-code" label="Código de 6 dígitos" required errorText={codeError}>
            <TextField
              id="otp-code"
              ref={codeRef}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              value={code}
              invalid={Boolean(codeError)}
              aria-describedby={fieldDescribedBy("otp-code", Boolean(codeError), false)}
              aria-required="true"
              onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              className="h-14 font-display text-h3 tracking-[0.4em] tabular-nums"
            />
          </FormField>
          <Button type="submit" size="lg" className="mt-2 w-full" loading={verifying || redirecting}>
            Entrar
          </Button>
        </form>

        <div className="mt-6 flex flex-col gap-4 border-t border-divider pt-5 sm:flex-row sm:items-center sm:justify-between">
          {cooling ? (
            <CountdownStatus
              variant="compact"
              label="Podrás pedir otro código en"
              expiredLabel="ya"
              expiresAt={cooldownUntil}
              onExpire={() => setCooldownUntil(null)}
            />
          ) : (
            <Button variant="secondary" loading={requesting} onClick={() => requestCode()}>
              Reenviar código
            </Button>
          )}
          <Button variant="ghost" onClick={changeEmail} className="-ml-2 self-start sm:self-auto">
            <ArrowLeft className="size-4" aria-hidden="true" />
            Usar otro correo
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      {noticeBlock}
      {returning ? <p className="mb-5 text-body-sm text-ink-60">Inicia sesión para continuar; después te llevamos de regreso.</p> : null}
      {googleEnabled ? (
        <Button asChild size="lg" className="w-full">
          <a href={`/api/v1/auth/google?next=${encodeURIComponent(next)}`}>
            <GoogleMark />
            Continuar con Google
          </a>
        </Button>
      ) : (
        <div>
          <Button size="lg" className="w-full" disabled>
            <GoogleMark />
            Continuar con Google
          </Button>
          <p className="mt-2 text-caption text-ink-60">El acceso con Google no está disponible por ahora. Usa tu correo.</p>
        </div>
      )}

      <div className="my-6 flex items-center gap-4" aria-hidden="true">
        <span className="h-px flex-1 bg-divider" />
        <span className="text-label text-ink-60">o</span>
        <span className="h-px flex-1 bg-divider" />
      </div>

      <form onSubmit={requestCode} noValidate>
        <FormField id="otp-email" label="Correo electrónico" required errorText={emailError} helperText="Te enviaremos un código de un solo uso.">
          <TextField
            id="otp-email"
            ref={emailRef}
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="nombre@correo.com"
            value={email}
            invalid={Boolean(emailError)}
            aria-describedby={fieldDescribedBy("otp-email", Boolean(emailError), true)}
            aria-required="true"
            onChange={(event) => setEmail(event.target.value)}
            onBlur={() => {
              if (email.trim() && !EMAIL_PATTERN.test(email.trim())) setEmailError("Escribe un correo válido, por ejemplo nombre@correo.com.");
              else setEmailError(undefined);
            }}
          />
        </FormField>
        <Button type="submit" variant="secondary" size="lg" className="mt-2 w-full" loading={requesting}>
          Enviar código
        </Button>
      </form>
    </div>
  );
}

/** Google "G" mark (Google sign-in branding), on a white disc so it reads on the ink button. */
function GoogleMark() {
  return (
    <span className="flex size-6 items-center justify-center rounded-full bg-paper-raised" aria-hidden="true">
      <svg viewBox="0 0 48 48" className="size-4">
        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
      </svg>
    </span>
  );
}
