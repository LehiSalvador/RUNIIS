"use client";

import React from "react";
import { usePathname, useRouter } from "next/navigation";
import { RotateCw, LogIn } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { ApiFailureCode } from "@/lib/client/api";
import type { JsonObject } from "@/lib/shared/api-contract";
import { describeFailure, KIND_LABEL, type AdminErrorView } from "@/components/admin/errors";

/**
 * Staff-facing error panel for one failed read or action (components/admin/errors.ts decides the
 * copy). Shows the kind, an actionable message and, always, the support reference (`request_id`).
 * `reload` re-renders the server page (router.refresh); `retry` calls `onRetry` when given (a failed
 * action) and otherwise also refreshes (a failed read). Never renders server-provided text.
 */
export type ErrorNoticeProps = {
  code: ApiFailureCode;
  requestId?: string | null;
  details?: JsonObject;
  /** Retry handler for a failed action; without it a retry re-renders the page. */
  onRetry?: () => void;
  /** Overrides the catalogue title, e.g. "No pudimos cargar las ediciones." */
  title?: string;
  className?: string;
};

export function ErrorNotice({ code, requestId = null, details, onRetry, title, className }: ErrorNoticeProps) {
  const view = describeFailure({ code, requestId, details });
  return <ErrorNoticeView view={view} onRetry={onRetry} title={title} className={className} />;
}

export function ErrorNoticeView({
  view,
  onRetry,
  title,
  className,
}: {
  view: AdminErrorView;
  onRetry?: () => void;
  title?: string;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = React.useTransition();

  const refresh = () => startTransition(() => router.refresh());
  let action: React.ReactNode = null;
  if (view.action === "retry" || view.action === "support") {
    action = (
      <Button variant="secondary" size="sm" loading={pending} onClick={onRetry ?? refresh}>
        <RotateCw className="size-4" aria-hidden="true" />
        Reintentar
      </Button>
    );
  } else if (view.action === "reload") {
    action = (
      <Button variant="secondary" size="sm" loading={pending} onClick={refresh}>
        <RotateCw className="size-4" aria-hidden="true" />
        Actualizar datos
      </Button>
    );
  } else if (view.action === "signin") {
    const next = encodeURIComponent(pathname || "/admin");
    action = (
      <Button asChild variant="secondary" size="sm">
        <a href={`/entrar?next=${next}`}>
          <LogIn className="size-4" aria-hidden="true" />
          Iniciar sesión
        </a>
      </Button>
    );
  }

  return (
    <Alert tone={view.tone} title={title ?? view.title} action={action} className={className}>
      <p>{view.message}</p>
      {view.retryAfterSeconds ? <p>Vuelve a intentar en {view.retryAfterSeconds} s.</p> : null}
      <p className="mt-1 text-caption text-ink-60" data-testid="error-reference">
        {KIND_LABEL[view.kind]}
        {view.requestId ? (
          <>
            {" · Referencia: "}
            <code className="font-mono text-ink-80 select-all">{view.requestId}</code>
          </>
        ) : null}
      </p>
    </Alert>
  );
}
