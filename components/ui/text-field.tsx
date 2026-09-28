import React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/client/cn";

/**
 * ui-spec §3.1 TextField: label input helper error, optional leading icon, success check icon for
 * async-validated fields. Composes with FormField for the label/helper/error wrapper -- this
 * component is the bare input, so it can also be used standalone (e.g. inside RegistrationParticipantCard
 * rows) with its own aria-describedby/aria-invalid wiring passed in directly.
 */
export type TextFieldProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> & {
  leadingIcon?: React.ReactNode;
  invalid?: boolean;
  success?: boolean;
  dense?: boolean;
};

export const TextField = React.forwardRef<HTMLInputElement, TextFieldProps>(
  ({ className, leadingIcon, invalid, success, dense, disabled, ...props }, ref) => (
    <div className="relative flex items-center">
      {leadingIcon ? (
        <span className="pointer-events-none absolute left-3 flex size-5 items-center justify-center text-ink-60">
          {leadingIcon}
        </span>
      ) : null}
      <input
        ref={ref}
        aria-invalid={invalid || undefined}
        disabled={disabled}
        className={cn(
          "w-full rounded-control border bg-paper-raised text-body text-ink transition-colors duration-fast ease-standard placeholder:text-ink-60",
          dense ? "h-9 px-3 text-body-sm" : "h-11 px-4",
          leadingIcon && "pl-10",
          success && !invalid && "pr-10",
          invalid ? "border-danger" : "border-control hover:border-ink-60 focus-visible:border-ink",
          disabled && "cursor-not-allowed border-divider bg-paper-sunken text-ink-35",
          className,
        )}
        {...props}
      />
      {success && !invalid ? (
        <span className="absolute right-3 flex size-5 items-center justify-center text-success">
          <Check className="size-4" aria-hidden="true" />
        </span>
      ) : null}
    </div>
  ),
);
TextField.displayName = "TextField";
