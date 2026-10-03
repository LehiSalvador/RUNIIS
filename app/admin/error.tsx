"use client";

import React from "react";
import { RotateCw } from "lucide-react";
import { AdminShell } from "@/components/shell/admin-shell";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

// Whole-page failure (for example the session read itself failed). Region-level read failures are handled
// inside each page. The shell renders with no section links (fail closed: this boundary does not know the
// role) and never shows a stack or internal message; the digest is the support reference.
export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <AdminShell pageTitle="Administración" navMode="live" visibleNavKeys={[]}>
      <Alert
        tone="danger"
        title="No pudimos cargar esta pantalla."
        action={
          <Button variant="secondary" size="sm" onClick={reset}>
            <RotateCw className="size-4" aria-hidden="true" />
            Reintentar
          </Button>
        }
      >
        <p>El servicio no respondió. Reintenta en un momento; si sigue igual, avisa a soporte con la referencia.</p>
        {error.digest ? (
          <p className="mt-1 text-caption text-ink-60" data-testid="error-reference">
            Referencia: <code className="font-mono text-ink-80 select-all">{error.digest}</code>
          </p>
        ) : null}
      </Alert>
    </AdminShell>
  );
}
