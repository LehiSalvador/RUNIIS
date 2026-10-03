import React from "react";
import {
  Ban,
  CalendarClock,
  CircleCheck,
  CircleDashed,
  EyeOff,
  Hourglass,
  Lock,
  MinusCircle,
  PauseCircle,
  PlayCircle,
  Radio,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/client/cn";

/**
 * Staff-side state badges. The public StatusBadge maps public availability states; staff need the raw
 * lifecycle states (publication, registration, execution). Never color alone: icon + label always.
 */
export type BadgeTone = "success" | "warning" | "info" | "danger" | "neutral";

const TONE_CLASS: Record<BadgeTone, string> = {
  success: "border-success-border bg-success-tint text-success",
  warning: "border-warning-border bg-warning-tint text-warning",
  info: "border-info-border bg-info-tint text-info",
  danger: "border-danger-border bg-danger-tint text-danger",
  neutral: "border-control bg-paper-sunken text-ink-80",
};

export function AdminBadge({
  icon: Icon,
  tone,
  children,
  className,
}: {
  icon: LucideIcon;
  tone: BadgeTone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-caption font-semibold",
        TONE_CLASS[tone],
        className,
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      {children}
    </span>
  );
}

type BadgeSpec = { icon: LucideIcon; tone: BadgeTone; label: string };

export const PUBLICATION_STATES: Record<string, BadgeSpec> = {
  DRAFT: { icon: CircleDashed, tone: "neutral", label: "Borrador" },
  PUBLISHED: { icon: CircleCheck, tone: "success", label: "Publicada" },
  HIDDEN: { icon: EyeOff, tone: "warning", label: "Oculta" },
};

export const REGISTRATION_STATES: Record<string, BadgeSpec> = {
  NOT_OPEN: { icon: Hourglass, tone: "neutral", label: "Aún no abre" },
  OPEN: { icon: PlayCircle, tone: "success", label: "Abierta" },
  PAUSED: { icon: PauseCircle, tone: "warning", label: "En pausa" },
  CLOSED: { icon: Lock, tone: "neutral", label: "Cerrada" },
};

export const EXECUTION_STATES: Record<string, BadgeSpec> = {
  SCHEDULED: { icon: CalendarClock, tone: "info", label: "Programada" },
  POSTPONED: { icon: CalendarClock, tone: "warning", label: "Aplazada" },
  IN_PROGRESS: { icon: Radio, tone: "info", label: "En curso" },
  FINISHED: { icon: MinusCircle, tone: "neutral", label: "Realizada" },
  CANCELED: { icon: XCircle, tone: "danger", label: "Cancelada" },
};

/** Administrative closure of an Edition (app.edition.closure_state); unknown values fall back to the raw text. */
export const CLOSURE_LABEL: Record<string, string> = { OPEN: "Abierto", PENDING: "Cierre pendiente", CLOSED: "Cerrado" };

const UNKNOWN: BadgeSpec = { icon: Ban, tone: "neutral", label: "Desconocido" };

function StateBadge({ table, value }: { table: Record<string, BadgeSpec>; value: string }) {
  const spec = table[value] ?? { ...UNKNOWN, label: value };
  return (
    <AdminBadge icon={spec.icon} tone={spec.tone}>
      {spec.label}
    </AdminBadge>
  );
}

export const PublicationBadge = ({ value }: { value: string }) => <StateBadge table={PUBLICATION_STATES} value={value} />;
export const RegistrationBadge = ({ value }: { value: string }) => <StateBadge table={REGISTRATION_STATES} value={value} />;
export const ExecutionBadge = ({ value }: { value: string }) => <StateBadge table={EXECUTION_STATES} value={value} />;

export const STATE_LABELS = {
  publication: Object.fromEntries(Object.entries(PUBLICATION_STATES).map(([k, v]) => [k, v.label])),
  registration: Object.fromEntries(Object.entries(REGISTRATION_STATES).map(([k, v]) => [k, v.label])),
  execution: Object.fromEntries(Object.entries(EXECUTION_STATES).map(([k, v]) => [k, v.label])),
} as const;
