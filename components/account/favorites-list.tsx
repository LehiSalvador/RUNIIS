"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, BellOff, Heart, HeartOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge, type StatusBadgeState } from "@/components/ui/status-badge";
import { toast } from "@/components/ui/use-toast";
import { RowList } from "@/components/account/section";
import { apiFetch } from "@/lib/client/api";
import { errorMessage } from "@/lib/client/account-errors";
import type { FavoriteView } from "@/lib/client/account-types";

/** J10 step 4: the current Edition state next to each favorite, so a stale favorite never misleads. */
export function editionStateBadge(registrationState: string, executionState: string): { state: StatusBadgeState; label?: string } {
  if (executionState === "CANCELED") return { state: "CANCELED" };
  if (executionState === "POSTPONED") return { state: "POSTPONED" };
  if (executionState === "FINISHED") return { state: "FINISHED" };
  if (registrationState === "OPEN") return { state: "AVAILABLE", label: "Inscripciones abiertas" };
  if (registrationState === "NOT_OPEN") return { state: "NOT_OPEN" };
  if (registrationState === "PAUSED") return { state: "CLOSED", label: "Inscripciones en pausa" };
  return { state: "CLOSED" };
}

export const REMINDER_LABELS: Record<string, string> = {
  ACTIVE: "Recordatorio activo",
  PENDING_CONFIRMATION: "Recordatorio por confirmar en tu correo",
  CANCELED: "Recordatorio cancelado",
  COMPLETED: "Recordatorio enviado",
};

export function FavoritesList({ favorites }: { favorites: FavoriteView[] }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);

  async function run(key: string, path: string, method: "POST" | "DELETE", success: string) {
    if (busy) return;
    setBusy(key);
    const result = await apiFetch(path, { method });
    setBusy(null);
    if (!result.ok) {
      toast({ tone: "danger", title: "No se pudo completar.", description: errorMessage(result) });
      return;
    }
    toast({ tone: "success", title: success });
    router.refresh();
  }

  if (favorites.length === 0) {
    return (
      <EmptyState
        icon={Heart}
        headingLevel="h2"
        title="No tienes carreras favoritas"
        description="Marca el corazón en una carrera para encontrarla aquí."
        action={
          <Button asChild>
            <Link href="/eventos">Explorar carreras</Link>
          </Button>
        }
        className="rounded-card border border-divider bg-paper-raised"
      />
    );
  }

  return (
    <RowList label="Carreras favoritas">
      {favorites.map((favorite) => {
        const badge = editionStateBadge(favorite.registration_state, favorite.execution_state);
        const reminderOn = favorite.reminder && (favorite.reminder.status === "ACTIVE" || favorite.reminder.status === "PENDING_CONFIRMATION");
        // Reminders announce registration opening (Master §130): only while it has not opened yet.
        const canRemind =
          favorite.execution_state !== "CANCELED" && (favorite.registration_state === "NOT_OPEN" || favorite.registration_state === "PAUSED");
        return (
          <li key={favorite.edition_id} className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between" data-testid="favorite-row">
            <div className="min-w-0">
              <Link href={`/eventos/${favorite.slug}`} className="text-body-lg font-bold text-ink hover:underline hover:underline-offset-4">
                {favorite.name}
              </Link>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <StatusBadge state={badge.state} label={badge.label} />
                {favorite.reminder && reminderOn ? <span className="text-body-sm text-ink-60">{REMINDER_LABELS[favorite.reminder.status]}</span> : null}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {reminderOn && favorite.reminder ? (
                <Button
                  size="sm"
                  variant="secondary"
                  loading={busy === `r-${favorite.edition_id}`}
                  onClick={() => run(`r-${favorite.edition_id}`, `/api/v1/reminders/${favorite.reminder!.reminder_id}`, "DELETE", "Recordatorio desactivado")}
                >
                  <BellOff className="size-4" aria-hidden="true" />
                  Quitar recordatorio<span className="sr-only"> de {favorite.name}</span>
                </Button>
              ) : canRemind ? (
                <Button
                  size="sm"
                  variant="secondary"
                  loading={busy === `r-${favorite.edition_id}`}
                  onClick={() => run(`r-${favorite.edition_id}`, `/api/v1/events/${favorite.edition_id}/reminders`, "POST", "Te avisaremos por correo")}
                >
                  <Bell className="size-4" aria-hidden="true" />
                  Recordarme<span className="sr-only"> {favorite.name}</span>
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                loading={busy === `f-${favorite.edition_id}`}
                onClick={() => run(`f-${favorite.edition_id}`, `/api/v1/events/${favorite.edition_id}/favorite`, "DELETE", "Quitado de favoritos")}
              >
                <HeartOff className="size-4" aria-hidden="true" />
                Quitar<span className="sr-only"> {favorite.name} de favoritos</span>
              </Button>
            </div>
          </li>
        );
      })}
    </RowList>
  );
}
