import React from "react";
import Link from "next/link";
import { ArrowLeft, FileQuestion, ShieldX } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * Full-page states rendered inside the admin shell. `AdminForbidden` is what a signed-in visitor without the
 * required role sees on a direct URL (the nav already hid the link; this is the actual refusal). It never says
 * which role would work or whether the record exists.
 */
export function AdminForbidden({ staff = true }: { staff?: boolean }) {
  return (
    <div className="rounded-card border border-divider bg-paper-raised" data-testid="admin-forbidden">
      <EmptyState
        icon={ShieldX}
        headingLevel="h2"
        title="No tienes acceso a esta sección"
        description={
          staff
            ? "Tu rol no incluye esta pantalla. Si la necesitas, pide a un administrador que ajuste tu acceso."
            : "Esta cuenta no tiene acceso al panel de administración."
        }
        action={
          <Link href={staff ? "/admin" : "/cuenta"} className={buttonVariants({ variant: "secondary" })}>
            <ArrowLeft className="size-4" aria-hidden="true" />
            {staff ? "Volver al inicio del panel" : "Ir a mi cuenta"}
          </Link>
        }
      />
    </div>
  );
}

export function AdminNotFound({ backHref, backLabel }: { backHref: string; backLabel: string }) {
  return (
    <div className="rounded-card border border-divider bg-paper-raised" data-testid="admin-not-found">
      <EmptyState
        icon={FileQuestion}
        headingLevel="h2"
        title="No encontramos este registro"
        description="No existe o el enlace es incorrecto."
        action={
          <Link href={backHref} className={buttonVariants({ variant: "secondary" })}>
            <ArrowLeft className="size-4" aria-hidden="true" />
            {backLabel}
          </Link>
        }
      />
    </div>
  );
}
