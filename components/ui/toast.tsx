"use client";

import React from "react";
import * as ToastPrimitive from "@radix-ui/react-toast";
import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import { cn } from "@/lib/client/cn";

/**
 * ui-spec §3.1 Toast: icon, message, optional action, auto-dismiss. Enters from the top on mobile
 * (never covers the sticky bottom CTA), bottom-right on desktop. 5s auto-dismiss pauses on hover;
 * error toasts never auto-dismiss. Radix announces through its own live region: "foreground"
 * (assertive) for errors, "background" (polite) for success/info -- the role=alert/status intent.
 */
export type ToastTone = "success" | "info" | "danger";

const TONE_ICON: Record<ToastTone, React.ComponentType<React.SVGProps<SVGSVGElement>>> = {
  success: CircleCheck,
  info: Info,
  danger: CircleAlert,
};

export const ToastProvider = ToastPrimitive.Provider;

export function ToastViewport({ className }: { className?: string }) {
  return (
    <ToastPrimitive.Viewport
      className={cn(
        "fixed inset-x-4 top-4 z-toast flex max-h-dvh flex-col gap-2 outline-none lg:inset-x-auto lg:top-auto lg:right-6 lg:bottom-6 lg:w-[380px]",
        className,
      )}
    />
  );
}

export type ToastItemProps = ToastPrimitive.ToastProps & {
  tone: ToastTone;
  title: string;
  description?: string;
};

export const ToastItem = React.forwardRef<React.ElementRef<typeof ToastPrimitive.Root>, ToastItemProps>(
  ({ tone, title, description, className, duration, ...props }, ref) => {
    const Icon = TONE_ICON[tone];
    return (
      <ToastPrimitive.Root
        ref={ref}
        duration={tone === "danger" ? Number.POSITIVE_INFINITY : (duration ?? 5000)}
        className={cn(
          "flex items-start gap-3 rounded-card border bg-paper-raised p-4 shadow-md",
          "data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:slide-in-from-top-4 lg:data-[state=open]:slide-in-from-top-0 lg:data-[state=open]:slide-in-from-bottom-4 data-[state=closed]:animate-out data-[state=closed]:fade-out data-[swipe=end]:animate-out duration-panel ease-standard",
          tone === "danger" ? "border-danger-border" : tone === "success" ? "border-success-border" : "border-info-border",
          className,
        )}
        type={tone === "danger" ? "foreground" : "background"}
        {...props}
      >
        <Icon
          aria-hidden="true"
          className={cn(
            "mt-0.5 size-5 shrink-0",
            tone === "danger" ? "text-danger" : tone === "success" ? "text-success" : "text-info",
          )}
        />
        <div className="flex-1">
          <ToastPrimitive.Title className="text-body font-semibold text-ink">{title}</ToastPrimitive.Title>
          {description ? (
            <ToastPrimitive.Description className="text-body-sm text-ink-60">
              {description}
            </ToastPrimitive.Description>
          ) : null}
        </div>
        <ToastPrimitive.Close
          aria-label="Cerrar notificación"
          className="-m-3 flex size-11 shrink-0 items-center justify-center rounded-control text-ink-60 hover:text-ink"
        >
          <X className="size-4" aria-hidden="true" />
        </ToastPrimitive.Close>
      </ToastPrimitive.Root>
    );
  },
);
ToastItem.displayName = "ToastItem";
