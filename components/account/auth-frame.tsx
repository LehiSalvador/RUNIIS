import React from "react";
import { cn } from "@/lib/client/cn";
import { Container } from "@/components/shell/container";
import { SkipLink } from "@/components/shell/skip-link";
import { Wordmark } from "@/components/shell/wordmark";
import { Runline } from "@/components/ui/runline";

/**
 * ui-spec §4.6/§4.7 frame for /entrar, /onboarding and single-purpose landings: wordmark only, no
 * marketing column, one h1, the task in a bordered raised panel. `width` picks modal-form (sign-in)
 * or registration (onboarding) containers.
 */
export function AuthFrame({
  title,
  lead,
  width = "modal-form",
  headerAction,
  footer,
  children,
}: {
  title: string;
  lead?: React.ReactNode;
  width?: "modal-form" | "registration";
  headerAction?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <SkipLink />
      <header className="border-b border-divider">
        <Container className="flex h-16 items-center justify-between gap-4">
          <Wordmark />
          {headerAction}
        </Container>
      </header>
      <main id="main-content" tabIndex={-1} className="flex-1 outline-none">
        <Container width={width} className="py-8 md:py-16">
          <h1 className="font-display text-h1 font-bold text-ink">{title}</h1>
          <Runline weight="strong" className="mt-3 w-16" />
          {lead ? <p className="mt-4 max-w-[var(--container-reading)] text-body-lg text-ink-80">{lead}</p> : null}
          <div className={cn("mt-8 rounded-panel border border-divider bg-paper-raised p-5 sm:p-8")}>{children}</div>
          {footer ? <div className="mt-6 text-caption text-ink-60">{footer}</div> : null}
        </Container>
      </main>
    </div>
  );
}
