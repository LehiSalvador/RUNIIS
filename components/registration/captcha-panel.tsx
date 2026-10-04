"use client";

import React from "react";
import { CircleCheck, Loader2, ShieldCheck, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/client/cn";
import { CAPTCHA_COPY, captchaVisible, type CaptchaState } from "./logic/captcha";

/**
 * OD-P2-01: shown ONLY when the server asked for a challenge (a new account on a WhatsApp Edition). The proof of work solves by
 * itself in the background: there is nothing to tick or type, so it works with keyboard, screen reader and touch alike. The status
 * line is a polite live region (verifying, ready, error); the retry action is a real button. The solved payload is never rendered.
 */
export function CaptchaPanel({ state, onRetry }: { state: CaptchaState; onRetry: () => void }) {
  if (!captchaVisible(state)) return null;

  const failed = state.phase === "error";
  const busy = state.phase === "solving" || state.phase === "checking";
  const message =
    state.phase === "solved"
      ? CAPTCHA_COPY.solved
      : state.phase === "error"
        ? state.kind === "probe"
          ? CAPTCHA_COPY.probeFailed
          : CAPTCHA_COPY.solveFailed
        : state.phase === "solving" || state.phase === "checking"
          ? state.renewing
            ? CAPTCHA_COPY.renewing
            : CAPTCHA_COPY.solving
          : CAPTCHA_COPY.solving;
  const Icon = state.phase === "solved" ? CircleCheck : failed ? TriangleAlert : Loader2;

  return (
    <section
      aria-labelledby="registration-captcha-title"
      data-testid="captcha-panel"
      data-state={state.phase === "error" ? `error-${state.kind}` : state.phase}
      className={cn(
        "flex flex-col gap-3 rounded-card border p-4",
        state.phase === "solved" ? "border-success-border bg-success-tint" : failed ? "border-warning-border bg-warning-tint" : "border-divider bg-paper-raised",
      )}
    >
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-ink-80" aria-hidden="true" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h3 id="registration-captcha-title" className="text-body font-semibold text-ink">
            {CAPTCHA_COPY.title}
          </h3>
          <p role="status" aria-live="polite" className="flex items-center gap-2 text-body-sm text-ink-80" data-testid="captcha-status">
            <Icon className={cn("size-4 shrink-0", busy ? "animate-spin motion-reduce:animate-none" : "")} aria-hidden="true" />
            <span>{message}</span>
          </p>
        </div>
      </div>
      {failed ? (
        <div>
          <Button variant="secondary" size="sm" onClick={onRetry} data-testid="captcha-retry">
            {CAPTCHA_COPY.retry}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
