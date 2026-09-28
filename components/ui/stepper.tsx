import React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/client/cn";

/** ui-spec §3.1 + §5.3 Stepper: one continuous 4px Runline track with rounded caps at its two ends
 * (neutral, lime over the completed part), numbered circles on top: current = display-num in an
 * ink ring, completed = ink fill + check. Selectable steps (completed and current by default) are
 * buttons in visual order; the rest are static. Below `sm` the labels collapse into a single
 * "Paso n de N" heading line beneath the track. */
export type StepperStep = { id: string; label: string };

export type StepperProps = {
  steps: StepperStep[];
  currentStepId: string;
  onStepSelect?: (stepId: string) => void;
  /** Which steps may be navigated to; defaults to completed steps and the current one. */
  isStepSelectable?: (stepId: string, index: number, currentIndex: number) => boolean;
  "aria-label"?: string;
  className?: string;
};

export function Stepper({
  steps,
  currentStepId,
  onStepSelect,
  isStepSelectable = (_id, index, currentIndex) => index <= currentIndex,
  "aria-label": ariaLabel = "Progreso",
  className,
}: StepperProps) {
  const currentIndex = Math.max(0, steps.findIndex((s) => s.id === currentStepId));
  const total = steps.length;
  const current = steps[currentIndex];
  const columnHalf = `${100 / (2 * total)}%`;
  const progress = total > 1 ? currentIndex / (total - 1) : 0;

  return (
    <nav aria-label={ariaLabel} className={cn("w-full", className)}>
      <div className="relative">
        <div
          aria-hidden="true"
          className="absolute top-[16px] h-1 rounded-full bg-divider"
          style={{ left: columnHalf, right: columnHalf }}
        >
          <div
            className="h-full rounded-full bg-lime transition-[width] duration-major ease-standard"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
        <ol className="relative grid" style={{ gridTemplateColumns: `repeat(${total}, minmax(0, 1fr))` }}>
          {steps.map((step, index) => {
            const isComplete = index < currentIndex;
            const isCurrent = index === currentIndex;
            const stateText = isComplete ? ", completado" : isCurrent ? ", paso actual" : "";
            const accessibleName = `Paso ${index + 1} de ${total}: ${step.label}${stateText}`;
            const circleClass = cn(
              "relative flex size-9 items-center justify-center rounded-full font-display text-label font-bold tabular-nums transition-colors duration-control ease-standard",
              isComplete && "bg-ink text-paper",
              isCurrent && "border-2 border-ink bg-paper-raised text-ink",
              !isComplete && !isCurrent && "border border-divider bg-paper-raised text-ink-60",
            );
            const circleContent = isComplete ? <Check className="size-4" aria-hidden="true" /> : index + 1;
            const selectable = Boolean(onStepSelect) && isStepSelectable(step.id, index, currentIndex);

            return (
              <li key={step.id} className="flex flex-col items-center" aria-current={isCurrent ? "step" : undefined}>
                {selectable ? (
                  <button
                    type="button"
                    aria-label={accessibleName}
                    onClick={() => onStepSelect?.(step.id)}
                    // 36px circle inside a 44px hit area.
                    className="group -m-1 flex size-11 items-center justify-center rounded-full focus-visible:outline-none"
                  >
                    <span
                      className={cn(
                        circleClass,
                        "group-hover:border-ink-60 group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-ring",
                      )}
                    >
                      {circleContent}
                    </span>
                  </button>
                ) : (
                  <span className={circleClass}>
                    <span className="sr-only">{accessibleName}</span>
                    <span aria-hidden="true">{circleContent}</span>
                  </span>
                )}
                <span
                  aria-hidden="true"
                  className={cn(
                    "mt-2 hidden px-1 text-center text-caption sm:block",
                    isCurrent ? "font-semibold text-ink" : "text-ink-60",
                  )}
                >
                  {step.label}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
      {current ? (
        <p className="mt-3 text-label font-semibold text-ink sm:hidden" aria-live="polite">
          Paso {currentIndex + 1} de {total}: {current.label}
        </p>
      ) : null}
    </nav>
  );
}
