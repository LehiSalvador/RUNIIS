"use client";

import { RotateCw } from "lucide-react";
import { AccountShell } from "@/components/shell/account-shell";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

// Whole-page failure (e.g. the session/profile read itself failed). Section-level read failures are
// handled inside each page; this never shows a stack or internal message.
export default function AccountError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <AccountShell pageTitle="Mi cuenta">
      <Alert
        tone="danger"
        title="No pudimos cargar tu cuenta."
        action={
          <Button variant="secondary" size="sm" onClick={reset}>
            <RotateCw className="size-4" aria-hidden="true" />
            Reintentar
          </Button>
        }
      >
        El servicio no respondió. Intenta de nuevo en un momento.
      </Alert>
    </AccountShell>
  );
}
