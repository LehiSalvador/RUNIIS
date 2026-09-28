import React from "react";
import Link from "next/link";
import { Ban, LockKeyhole, PowerOff, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SignOutButton } from "@/components/account/sign-out-button";

type Restriction = "IDENTITY_LOCKED" | "BANNED" | "DEACTIVATED";

// ux-spec §5 rule 10 / J11: state the fact and the next step (support), never internal notes or reasons.
const COPY: Record<Restriction, { icon: LucideIcon; title: string; body: string }> = {
  IDENTITY_LOCKED: {
    icon: LockKeyhole,
    title: "Tu cuenta está en revisión",
    body: "Mientras dure la revisión no puedes inscribirte ni hacer cambios en tu cuenta. Escríbenos por WhatsApp para resolverlo.",
  },
  BANNED: {
    icon: Ban,
    title: "Esta cuenta no puede realizar acciones",
    body: "Tu cuenta tiene una restricción y no puede inscribirse ni hacer cambios. Si crees que es un error, contacta a soporte.",
  },
  DEACTIVATED: {
    icon: PowerOff,
    title: "Esta cuenta está desactivada",
    body: "No puedes usar las funciones de tu cuenta mientras esté desactivada. Contacta a soporte si necesitas reactivarla.",
  },
};

export function RestrictedAccount({ restriction }: { restriction: Restriction }) {
  const { icon: Icon, title, body } = COPY[restriction];
  return (
    <div className="max-w-[var(--container-reading)] rounded-panel border border-divider bg-paper-raised p-6 md:p-8" data-testid="restricted-account">
      <Icon className="size-10 text-ink-60" aria-hidden="true" />
      <h2 className="mt-4 font-display text-h3 font-bold text-ink">{title}</h2>
      <p className="mt-2 text-body text-ink-80">{body}</p>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <Button asChild>
          <Link href="/contacto">Contactar a soporte</Link>
        </Button>
        <SignOutButton />
      </div>
    </div>
  );
}
