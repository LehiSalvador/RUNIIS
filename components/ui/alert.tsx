import React from "react";
import { CircleAlert, CircleCheck, Info, TriangleAlert, X, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/client/cn";
import { IconButton } from "@/components/ui/icon-button";

/** ui-spec §3.1 AlertCallout: icon, title, body, optional action link. Danger/warning use role=alert,
 * info/success use role=status (matches the S183/S190 "never color alone" rule via icon+text). */
export type AlertTone = "info" | "success" | "warning" | "danger";

const TONE: Record<AlertTone, { icon: LucideIcon; role: "alert" | "status"; classes: string }> = {
  info: { icon: Info, role: "status", classes: "border-info-border bg-info-tint text-info" },
  success: { icon: CircleCheck, role: "status", classes: "border-success-border bg-success-tint text-success" },
  warning: { icon: TriangleAlert, role: "alert", classes: "border-warning-border bg-warning-tint text-warning" },
  danger: { icon: CircleAlert, role: "alert", classes: "border-danger-border bg-danger-tint text-danger" },
};

export type AlertProps = {
  tone: AlertTone;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  dismissible?: boolean;
  onDismiss?: () => void;
  className?: string;
};

export function Alert({ tone, title, children, action, dismissible, onDismiss, className }: AlertProps) {
  const { icon: Icon, role, classes } = TONE[tone];

  return (
    <div role={role} className={cn("flex gap-3 rounded-card border p-4", classes, className)}>
      <Icon className="size-5 shrink-0" aria-hidden="true" />
      <div className="flex-1 space-y-1">
        <p className="text-body font-semibold text-ink">{title}</p>
        {children ? <div className="text-body-sm text-ink-80">{children}</div> : null}
        {action ? <div className="pt-1">{action}</div> : null}
      </div>
      {dismissible ? (
        <IconButton aria-label="Cerrar aviso" variant="ghost" size="sm" onClick={onDismiss} className="-m-2.5">
          <X className="size-4" aria-hidden="true" />
        </IconButton>
      ) : null}
    </div>
  );
}
