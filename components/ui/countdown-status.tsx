"use client";

import React from "react";
import { CircleAlert } from "lucide-react";
import { cn } from "@/lib/client/cn";
import { Runline } from "@/components/ui/runline";
import { createServerClock, getCountdownState, type CountdownState } from "@/lib/client/countdown";

/**
 * ui-spec §3.3 CountdownStatus. Time left = server `expiresAt` minus a skew-corrected clock
 * (`serverNow` from the same API response), re-derived every second and on tab re-focus. At expiry it
 * flips instantly to a static "Expirada" state without a server round trip. The ticking number is a
 * role=timer (not announced every second); a separate polite region announces only the 5-minute
 * warning and expiry. The first render is a placeholder so server and client HTML match.
 * `variant="compact"` is the OTP resend cooldown: body scale, no Runline accent.
 */
export type CountdownStatusProps = {
  expiresAt: string | Date;
  /** Server time captured with `expiresAt` (e.g. the response's `meta.server_time`). */
  serverNow?: string | Date | null;
  variant?: "display" | "compact";
  label?: string;
  expiredLabel?: string;
  onExpire?: () => void;
  className?: string;
};

export function CountdownStatus({
  expiresAt,
  serverNow,
  variant = "display",
  label = "Tiempo restante",
  expiredLabel = "Expirada",
  onExpire,
  className,
}: CountdownStatusProps) {
  const [state, setState] = React.useState<CountdownState | null>(null);
  const onExpireRef = React.useRef(onExpire);
  React.useEffect(() => {
    onExpireRef.current = onExpire;
  });

  const serverNowKey = serverNow instanceof Date ? serverNow.toISOString() : (serverNow ?? null);
  const expiresKey = expiresAt instanceof Date ? expiresAt.toISOString() : expiresAt;

  React.useEffect(() => {
    const now = createServerClock(serverNowKey);
    let expiredFired = false;
    let interval: ReturnType<typeof setInterval> | undefined;

    const tick = () => {
      const next = getCountdownState(expiresKey, now());
      setState(next);
      if (next.expired) {
        clearInterval(interval);
        if (!expiredFired) {
          expiredFired = true;
          onExpireRef.current?.();
        }
      }
    };

    tick();
    interval = setInterval(tick, 1000);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [expiresKey, serverNowKey]);

  const compact = variant === "compact";
  const expired = state?.expired ?? false;
  const announcement = expired
    ? `${label}: ${expiredLabel}`
    : !compact && state?.inFinalWarning
      ? "Quedan menos de 5 minutos"
      : "";

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <span className="text-label font-semibold text-ink-60">{label}</span>
      {expired ? (
        <span
          className={cn(
            "inline-flex items-center gap-2 font-bold text-danger",
            compact ? "font-body text-body" : "font-display text-h2",
          )}
        >
          <CircleAlert className={compact ? "size-4" : "size-6"} aria-hidden="true" />
          {expiredLabel}
        </span>
      ) : (
        <span
          role="timer"
          aria-label={label}
          className={cn(
            "font-bold tabular-nums",
            compact ? "font-body text-body" : "font-display text-h2",
            !compact && state?.inFinalWarning ? "text-warning" : "text-ink",
          )}
        >
          {state?.formatted ?? "--:--:--"}
        </span>
      )}
      {!compact && !expired ? <Runline weight="normal" tone="signal" className="w-16" /> : null}
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
    </div>
  );
}
