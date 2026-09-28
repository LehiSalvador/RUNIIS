"use client";

import React from "react";
import Link from "next/link";
import { BellRing, CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/client/api";

type Outcome = { kind: "idle" } | { kind: "confirmed"; name: string; slug: string } | { kind: "invalid" } | { kind: "retry" };

/**
 * Landing for the anonymous-reminder email. The token is dropped from the address bar as soon as
 * the page loads (it stays only in memory) and is sent once, by POST, when the person clicks.
 * Unknown, used and expired tokens share one generic message (no oracle).
 */
export function ReminderConfirm({ token }: { token: string | null }) {
  const [outcome, setOutcome] = React.useState<Outcome>(token ? { kind: "idle" } : { kind: "invalid" });
  const [pending, setPending] = React.useState(false);
  const headingRef = React.useRef<HTMLHeadingElement>(null);

  React.useEffect(() => {
    if (window.location.search) window.history.replaceState(null, "", window.location.pathname);
  }, []);

  React.useEffect(() => {
    if (outcome.kind !== "idle") headingRef.current?.focus();
  }, [outcome.kind]);

  async function confirm() {
    if (!token || pending) return;
    setPending(true);
    const result = await apiFetch<{ status: "CONFIRMED"; edition: { slug: string; name: string } }>("/api/v1/reminders/confirm", {
      method: "POST",
      body: { token },
    });
    setPending(false);
    if (result.ok) setOutcome({ kind: "confirmed", name: result.data.edition.name, slug: result.data.edition.slug });
    else if (result.code === "RATE_LIMITED" || result.code === "NETWORK_ERROR" || result.code === "DEPENDENCY_UNAVAILABLE") setOutcome({ kind: "retry" });
    else setOutcome({ kind: "invalid" });
  }

  if (outcome.kind === "confirmed") {
    return (
      <div role="status">
        <BellRing className="size-10 text-success" aria-hidden="true" />
        <h2 ref={headingRef} tabIndex={-1} className="mt-4 text-h3 font-bold text-ink outline-none">
          Listo, tu recordatorio está activo
        </h2>
        <p className="mt-2 text-body text-ink-80">Te avisaremos por correo sobre {outcome.name}.</p>
        <Button asChild className="mt-6">
          <Link href={`/eventos/${outcome.slug}`}>Ver la carrera</Link>
        </Button>
      </div>
    );
  }

  if (outcome.kind === "invalid") {
    return (
      <div role="status">
        <CircleAlert className="size-10 text-ink-60" aria-hidden="true" />
        <h2 ref={headingRef} tabIndex={-1} className="mt-4 text-h3 font-bold text-ink outline-none">
          Este enlace ya no es válido
        </h2>
        <p className="mt-2 text-body text-ink-80">
          Puede que ya lo hayas usado o que haya expirado. Si quieres recibir avisos, activa «Recordarme» otra vez desde la
          página de la carrera.
        </p>
        <Button asChild variant="secondary" className="mt-6">
          <Link href="/eventos">Explorar carreras</Link>
        </Button>
      </div>
    );
  }

  return (
    <div>
      {outcome.kind === "retry" ? (
        <p ref={headingRef} tabIndex={-1} role="alert" className="mb-4 text-body text-danger outline-none">
          No pudimos confirmar en este momento. Espera un poco e intenta de nuevo.
        </p>
      ) : null}
      <p className="text-body text-ink-80">Confirma que este correo es tuyo y que quieres el recordatorio.</p>
      <Button size="lg" className="mt-6 w-full sm:w-auto" loading={pending} onClick={confirm}>
        Confirmar recordatorio
      </Button>
    </div>
  );
}
