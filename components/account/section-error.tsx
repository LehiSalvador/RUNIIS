"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { RotateCw } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/client/account-errors";
import type { ApiFailureCode } from "@/lib/client/api";

/** A failed server read for one section: the catalogue message plus a retry that re-renders the page. */
export function SectionError({ code, title = "No pudimos cargar esta sección." }: { code: ApiFailureCode; title?: string }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  return (
    <Alert
      tone="danger"
      title={title}
      action={
        <Button variant="secondary" size="sm" loading={pending} onClick={() => startTransition(() => router.refresh())}>
          <RotateCw className="size-4" aria-hidden="true" />
          Reintentar
        </Button>
      }
    >
      {errorMessage({ code })}
    </Alert>
  );
}
