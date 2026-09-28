import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarX, ScanLine } from "lucide-react";
import { AccountShell } from "@/components/shell/account-shell";
import { AdminShell } from "@/components/shell/admin-shell";
import { ScannerShell } from "@/components/shell/scanner-shell";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { SearchInput } from "@/components/ui/search-input";

const SHELLS = ["account", "admin", "scanner"] as const;
type ShellName = (typeof SHELLS)[number];

// Per request, like /design-system, so the APP_ENV gate is evaluated at runtime.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Shells",
  robots: { index: false, follow: false },
};

function BackLink() {
  return (
    <Button asChild variant="secondary" size="sm">
      <Link href="/design-system">Volver al sistema de diseño</Link>
    </Button>
  );
}

/** Shell previews for visual QA with placeholder content only (T15); same production gate as
 * /design-system. Real pages compose these shells themselves. */
export default async function ShellPreviewPage({ params }: { params: Promise<{ shell: string }> }) {
  if (process.env.APP_ENV === "production") notFound();
  const { shell } = await params;
  if (!SHELLS.includes(shell as ShellName)) notFound();

  if (shell === "account") {
    return (
      <AccountShell pageTitle="Resumen">
        <div className="rounded-card border border-divider bg-paper-raised">
          <EmptyState
            icon={CalendarX}
            headingLevel="h2"
            title="Todavía no tienes inscripciones"
            description="Cuando te inscribas a una carrera, verás aquí tu solicitud y tu pase."
            action={<BackLink />}
          />
        </div>
      </AccountShell>
    );
  }

  if (shell === "admin") {
    return (
      <AdminShell
        pageTitle="Dashboard"
        visibleNavKeys={["dashboard", "tareas", "eventos", "solicitudes", "participantes", "asistencia"]}
        actions={<BackLink />}
      >
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "Ediciones próximas", value: "4" },
            { label: "Solicitudes pendientes", value: "27" },
            { label: "Ocupación", value: "68%" },
            { label: "Asistencia pendiente", value: "12" },
          ].map((tile) => (
            <li key={tile.label} className="rounded-card border border-divider bg-paper-raised p-5">
              <p className="text-label font-semibold text-ink-60">{tile.label}</p>
              <p className="mt-2 font-display text-h2 font-bold tabular-nums text-ink">{tile.value}</p>
            </li>
          ))}
        </ul>
      </AdminShell>
    );
  }

  return (
    <ScannerShell
      sessionContext={
        <div className="min-w-0">
          <p className="truncate font-semibold text-paper">Medio Maratón Ciudad 2026</p>
          <p className="truncate text-caption text-paper/70">Acceso norte · Check-in</p>
        </div>
      }
      manualLookup={
        <FormField id="scanner-lookup" label="Número de inscripción o código público">
          <SearchInput id="scanner-lookup" placeholder="Ej. 0142 o RN-8F3K-Q2" />
        </FormField>
      }
    >
      <div className="flex h-full flex-col items-center justify-center gap-6 px-6 text-center">
        <div className="flex size-56 items-center justify-center rounded-overlay border-2 border-dashed border-paper/40">
          <ScanLine className="size-16 text-lime" aria-hidden="true" />
        </div>
        <p className="max-w-xs text-body text-paper/80">Listo para escanear. Apunta la cámara al código QR del pase.</p>
        <Link href="/design-system" className="inline-flex min-h-11 items-center text-body-sm text-paper underline underline-offset-4">
          Volver al sistema de diseño
        </Link>
      </div>
    </ScannerShell>
  );
}
