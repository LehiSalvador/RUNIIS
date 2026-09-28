"use client";

import React from "react";
import { CalendarDays } from "lucide-react";
import { cn } from "@/lib/client/cn";
import { displayToIso, isoToDisplay, maskDateDigits } from "@/lib/client/date-input";

/**
 * ui-spec §3.1 DateInput: a text field with a visible Spanish "dd/mm/aaaa" mask (independent of the
 * browser locale) plus a calendar button that opens the native date picker. Values exchanged with
 * the caller are ISO "yyyy-mm-dd"; `onValueChange` receives `null` while the text is incomplete or
 * not a real date so the caller can show the FormField error -- the text is never auto-corrected.
 */
export type DateInputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "defaultValue" | "onChange" | "min" | "max"
> & {
  /** Controlled ISO value ("" or undefined = empty). */
  value?: string;
  defaultValue?: string;
  onValueChange?: (iso: string | null, display: string) => void;
  /** ISO bounds, forwarded to the native picker. */
  min?: string;
  max?: string;
  invalid?: boolean;
};

export const DateInput = React.forwardRef<HTMLInputElement, DateInputProps>(
  (
    { className, invalid, disabled, value, defaultValue, onValueChange, min, max, placeholder, ...props },
    ref,
  ) => {
    const pickerRef = React.useRef<HTMLInputElement>(null);
    const [display, setDisplay] = React.useState(() => isoToDisplay(value ?? defaultValue));

    // Adopt external value changes, but never wipe a partial entry the parent reports as empty.
    const [lastValue, setLastValue] = React.useState(value);
    if (value !== lastValue) {
      setLastValue(value);
      if ((value || null) !== displayToIso(display)) {
        setDisplay(isoToDisplay(value));
      }
    }

    function commit(nextDisplay: string) {
      setDisplay(nextDisplay);
      onValueChange?.(displayToIso(nextDisplay), nextDisplay);
    }

    function openPicker() {
      const picker = pickerRef.current;
      if (!picker) return;
      picker.value = displayToIso(display) ?? "";
      try {
        picker.showPicker();
      } catch {
        // Browsers without showPicker keep the fully functional typed entry.
      }
    }

    return (
      <div className="relative flex items-center">
        <input
          ref={ref}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder={placeholder ?? "dd/mm/aaaa"}
          maxLength={10}
          aria-invalid={invalid || undefined}
          disabled={disabled}
          value={display}
          onChange={(event) => commit(maskDateDigits(event.target.value))}
          className={cn(
            "h-11 w-full rounded-control border bg-paper-raised pl-4 pr-12 text-body text-ink tabular-nums transition-colors duration-fast ease-standard placeholder:text-ink-60",
            invalid ? "border-danger" : "border-control hover:border-ink-60 focus-visible:border-ink",
            disabled && "cursor-not-allowed border-divider bg-paper-sunken text-ink-35",
            className,
          )}
          {...props}
        />
        <input
          ref={pickerRef}
          type="date"
          tabIndex={-1}
          aria-hidden="true"
          min={min}
          max={max}
          onChange={(event) => commit(isoToDisplay(event.target.value))}
          className="pointer-events-none absolute right-0 bottom-0 size-px opacity-0"
        />
        <button
          type="button"
          aria-label="Abrir calendario"
          disabled={disabled}
          onClick={openPicker}
          className="absolute right-0 flex size-11 items-center justify-center rounded-control text-ink-60 hover:text-ink disabled:pointer-events-none disabled:text-ink-35"
        >
          <CalendarDays className="size-5" aria-hidden="true" />
        </button>
      </div>
    );
  },
);
DateInput.displayName = "DateInput";
