import React from "react";
import {
  Ban,
  CalendarClock,
  CircleCheck,
  Clock,
  LoaderCircle,
  MinusCircle,
  Radio as RadioIcon,
  ShieldCheck,
  TriangleAlert,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/client/cn";

/** ui-spec §3.2 domain-to-semantic mapping, verbatim. Never color alone -- icon + label always. */
export type StatusBadgeTone = "success" | "warning" | "info" | "danger" | "neutral";

export type StatusBadgeState =
  | "AVAILABLE"
  | "LOW"
  | "TEMPORARILY_UNAVAILABLE"
  | "SOLD_OUT"
  | "CLOSED"
  | "NOT_OPEN"
  | "FINISHED"
  | "CANCELED"
  | "POSTPONED"
  | "REQUEST_PENDING"
  | "REGISTRATION_CONFIRMED"
  | "RANKING_OPEN"
  | "RANKING_CONSOLIDATING"
  | "RANKING_CLOSED";

const STATE_MAP: Record<StatusBadgeState, { icon: LucideIcon; tone: StatusBadgeTone; label: string }> = {
  AVAILABLE: { icon: CircleCheck, tone: "success", label: "Disponible" },
  LOW: { icon: TriangleAlert, tone: "warning", label: "Pocos lugares" },
  TEMPORARILY_UNAVAILABLE: { icon: Clock, tone: "info", label: "Temporalmente no disponible" },
  SOLD_OUT: { icon: Ban, tone: "danger", label: "Agotado" },
  CLOSED: { icon: MinusCircle, tone: "neutral", label: "Inscripciones cerradas" },
  NOT_OPEN: { icon: MinusCircle, tone: "neutral", label: "Próximamente" },
  FINISHED: { icon: MinusCircle, tone: "neutral", label: "Evento realizado" },
  CANCELED: { icon: XCircle, tone: "danger", label: "Cancelado" },
  POSTPONED: { icon: CalendarClock, tone: "warning", label: "Aplazado" },
  REQUEST_PENDING: { icon: Clock, tone: "warning", label: "Apartado" },
  REGISTRATION_CONFIRMED: { icon: CircleCheck, tone: "success", label: "Confirmado" },
  RANKING_OPEN: { icon: RadioIcon, tone: "info", label: "Proyección en vivo" },
  RANKING_CONSOLIDATING: { icon: LoaderCircle, tone: "warning", label: "En consolidación" },
  RANKING_CLOSED: { icon: ShieldCheck, tone: "success", label: "Resultado oficial" },
};

const TONE_CLASS: Record<StatusBadgeTone, string> = {
  success: "border-success-border bg-success-tint text-success",
  warning: "border-warning-border bg-warning-tint text-warning",
  info: "border-info-border bg-info-tint text-info",
  danger: "border-danger-border bg-danger-tint text-danger",
  neutral: "border-control bg-paper-sunken text-ink-60",
};

export type StatusBadgeProps = {
  state: StatusBadgeState;
  /** Override the default verbatim label (context-specific copy for the same state). */
  label?: string;
  /** Renders as a selectable FilterBar chip: 2px lime-deep border when selected, aria-pressed. */
  asFilterChip?: boolean;
  selected?: boolean;
  onSelectedChange?: (selected: boolean) => void;
  className?: string;
};

export function StatusBadge({
  state,
  label,
  asFilterChip,
  selected,
  onSelectedChange,
  className,
}: StatusBadgeProps) {
  const { icon: Icon, tone, label: defaultLabel } = STATE_MAP[state];
  const content = (
    <>
      <Icon className="size-4" aria-hidden="true" />
      <span className="tabular-nums">{label ?? defaultLabel}</span>
    </>
  );

  const base = cn(
    "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-label font-semibold",
    TONE_CLASS[tone],
    className,
  );

  if (!asFilterChip) {
    return <span className={base}>{content}</span>;
  }

  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onSelectedChange?.(!selected)}
      className={cn(
        base,
        "min-h-11 border-2 transition-colors duration-fast ease-standard",
        selected ? "border-lime-deep" : "hover:border-ink-60",
      )}
    >
      {content}
    </button>
  );
}
