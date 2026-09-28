"use client";

import React from "react";
import Link from "next/link";
import { Ban, Clock, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/client/cn";
import {
  publicStatus,
  type AvailabilityState,
  type ExecutionState,
  type RegistrationState,
} from "@/lib/shared/public-event";

// Master §60 / SEC-051/052: the Event page is cached, availability is not. The page ships the
// Edition's registration/execution state; the availability state is read fresh from
// GET /api/v1/events/:slug/availability (no-store) in the browser, only when it can change the CTA.

export type CtaCode = "REGISTER" | "TEMPORARILY_UNAVAILABLE" | "SOLD_OUT" | "REMIND_ME" | "CLOSED" | "CANCELED" | "POSTPONED" | "FINISHED";
export type Cta = { code: CtaCode; label: string };
/** mapCta() results precomputed on the server for each possible global availability state. */
export type CtaByAvailability = Record<AvailabilityState | "NONE", Cta>;

type ModalityAvailability = { modality_id: string; status: "ACTIVE" | "CLOSED"; state: AvailabilityState };
type Availability = { global_state: AvailabilityState; modalities: ModalityAvailability[] };

type AvailabilityValue =
  | { status: "static" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; availability: Availability };

type ContextValue = {
  slug: string;
  registration: RegistrationState;
  execution: ExecutionState;
  ctas: CtaByAvailability;
  value: AvailabilityValue;
};

const AvailabilityContext = React.createContext<ContextValue | null>(null);

function useAvailability(): ContextValue {
  const context = React.useContext(AvailabilityContext);
  if (!context) throw new Error("AvailabilityProvider missing");
  return context;
}

/** Availability only matters while registration is OPEN on a live Edition (mapCta precedence). */
export function availabilityMatters(registration: RegistrationState, execution: ExecutionState): boolean {
  return registration === "OPEN" && (execution === "SCHEDULED" || execution === "IN_PROGRESS");
}

function parseAvailability(body: unknown): Availability | null {
  const data = (body as { data?: unknown } | null)?.data as Partial<Availability> | undefined;
  const states = ["AVAILABLE", "LOW", "TEMPORARILY_UNAVAILABLE", "SOLD_OUT"];
  if (!data || typeof data.global_state !== "string" || !states.includes(data.global_state) || !Array.isArray(data.modalities)) {
    return null;
  }
  return { global_state: data.global_state, modalities: data.modalities };
}

export function AvailabilityProvider({
  slug,
  registration,
  execution,
  ctas,
  children,
}: {
  slug: string;
  registration: RegistrationState;
  execution: ExecutionState;
  ctas: CtaByAvailability;
  children: React.ReactNode;
}) {
  const live = availabilityMatters(registration, execution);
  const [value, setValue] = React.useState<AvailabilityValue>(live ? { status: "loading" } : { status: "static" });

  React.useEffect(() => {
    if (!live) return;
    const controller = new AbortController();
    fetch(`/api/v1/events/${encodeURIComponent(slug)}/availability`, {
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: controller.signal,
    })
      .then(async (response) => {
        const availability = response.ok ? parseAvailability(await response.json()) : null;
        setValue(availability ? { status: "ready", availability } : { status: "error" });
      })
      .catch(() => {
        if (!controller.signal.aborted) setValue({ status: "error" });
      });
    return () => controller.abort();
  }, [live, slug]);

  const context = React.useMemo(() => ({ slug, registration, execution, ctas, value }), [slug, registration, execution, ctas, value]);
  return <AvailabilityContext.Provider value={context}>{children}</AvailabilityContext.Provider>;
}

function currentCta({ ctas, value }: ContextValue): Cta {
  if (value.status === "ready") return ctas[value.availability.global_state];
  return ctas.NONE;
}

export function EventStatusBadge({ className }: { className?: string }) {
  const context = useAvailability();
  const { value, registration, execution } = context;
  if (value.status === "loading") return <Skeleton className={cn("h-8 w-40 rounded-full", className)} />;
  const state = value.status === "ready" ? value.availability.global_state : null;
  const status = publicStatus(registration, execution, state);
  return <StatusBadge state={status.state} label={status.label} className={className} />;
}

/** Per-Modality state (a Modality can close or fill up on its own). */
export function ModalityAvailabilityBadge({ modalityId, modalityStatus }: { modalityId: string; modalityStatus: string }) {
  const { value, registration, execution } = useAvailability();
  if (modalityStatus === "CANCELED") return <StatusBadge state="CANCELED" label="Modalidad cancelada" />;
  if (!availabilityMatters(registration, execution)) return null;
  if (value.status === "loading") return <Skeleton className="h-8 w-28 rounded-full" />;
  if (value.status !== "ready") return null;
  const modality = value.availability.modalities.find((m) => m.modality_id === modalityId);
  if (!modality) return null;
  if (modality.status === "CLOSED" || modalityStatus === "CLOSED") return <StatusBadge state="CLOSED" label="Modalidad cerrada" />;
  const status = publicStatus("OPEN", "SCHEDULED", modality.state);
  return <StatusBadge state={status.state} label={modality.state === "AVAILABLE" ? "Disponible" : status.label} />;
}

const REMINDER_HELP_ID = "cta-recordarme-ayuda";

export function EventCta({
  size = "lg",
  className,
  idSuffix,
  compact = false,
}: {
  size?: "md" | "lg";
  className?: string;
  idSuffix: string;
  /** Sticky bar: the explanatory helper lines live next to the inline CTA instead. */
  compact?: boolean;
}) {
  const context = useAvailability();
  const { slug, value } = context;
  const helpId = `${REMINDER_HELP_ID}-${idSuffix}`;

  if (value.status === "loading") {
    return (
      <Button size={size} loading className={cn("w-full", className)}>
        Consultando disponibilidad
      </Button>
    );
  }

  const cta = currentCta(context);

  if (cta.code === "REGISTER") {
    return (
      <div className={cn("flex flex-col gap-2", className)}>
        <Button asChild size={size} className="w-full">
          {/* No prefetch: the registration builder is session-gated and heavy; load it only on intent. */}
          <Link href={`/inscripcion/${slug}`} prefetch={false}>
            {cta.label}
          </Link>
        </Button>
        {value.status === "error" && !compact ? (
          <p className="text-caption text-ink-60">No pudimos confirmar la disponibilidad en este momento; se verifica al inscribirte.</p>
        ) : null}
      </div>
    );
  }

  if (cta.code === "REMIND_ME") {
    return (
      <div className={cn("flex flex-col gap-2", className)}>
        <Button size={size} variant="secondary" disabled aria-describedby={compact ? undefined : helpId} className="w-full">
          {cta.label}
        </Button>
        <p id={helpId} hidden={compact} className="text-caption text-ink-60">
          Los recordatorios por correo estarán disponibles pronto. Consulta esta página para ver cuándo abren las inscripciones.
        </p>
      </div>
    );
  }

  return (
    <Button size={size} variant="secondary" disabled className={cn("w-full", className)}>
      {cta.label}
    </Button>
  );
}

/** Master §56 page-level variants that depend on fresh availability (the static ones render on the server). */
export function AvailabilityNotice() {
  const { value } = useAvailability();
  if (value.status !== "ready") return null;
  const state = value.availability.global_state;
  const notice =
    state === "SOLD_OUT"
      ? { icon: Ban, tone: "border-danger-border bg-danger-tint text-danger", title: "Agotado", body: "Ya no quedan lugares disponibles para esta edición." }
      : state === "TEMPORARILY_UNAVAILABLE"
        ? {
            icon: Clock,
            tone: "border-info-border bg-info-tint text-info",
            title: "Temporalmente sin disponibilidad",
            body: "Los lugares restantes están apartados por solicitudes en proceso y podrían liberarse. Vuelve a consultar más tarde.",
          }
        : state === "LOW"
          ? { icon: TriangleAlert, tone: "border-warning-border bg-warning-tint text-warning", title: "Pocos lugares", body: "Quedan pocos lugares disponibles." }
          : null;
  if (!notice) return null;
  const Icon = notice.icon;
  return (
    <div role="status" className={cn("flex gap-3 rounded-card border p-4", notice.tone)}>
      <Icon className="size-5 shrink-0" aria-hidden="true" />
      <div>
        <p className="font-semibold text-ink">{notice.title}</p>
        <p className="mt-1 text-body-sm text-ink-80">{notice.body}</p>
      </div>
    </div>
  );
}
