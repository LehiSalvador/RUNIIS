import React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/client/cn";

/**
 * ui-spec §3.1 IconButton. The outer <button> is always the >=44px hit target (Master §189) and
 * receives `className` (layout/visibility); the visible box is the inner span, so an "sm" control
 * looks 36px while still resolving a 44px tap area. `inverse` is the ghost variant for ink surfaces
 * (footer, scanner) where ink-on-ink glyphs would be invisible.
 */
const visualVariants = cva(
  "inline-flex items-center justify-center rounded-control border transition-colors duration-fast ease-standard",
  {
    variants: {
      variant: {
        ghost:
          "border-transparent bg-transparent text-ink group-hover:border-control group-active:bg-paper-sunken",
        filled: "border-ink bg-ink text-paper group-hover:bg-ink-80 group-active:bg-ink",
        inverse:
          "border-transparent bg-transparent text-paper group-hover:border-paper/50 group-active:bg-paper/10",
      },
      size: {
        sm: "size-9",
        md: "size-11",
        lg: "size-13",
      },
    },
    defaultVariants: { variant: "ghost", size: "md" },
  },
);

const hitSize = { sm: "size-11", md: "size-11", lg: "size-13" } as const;

export type IconButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof visualVariants> & {
    "aria-label": string;
    loading?: boolean;
  };

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, variant = "ghost", size = "md", loading = false, disabled, children, type, ...props }, ref) => {
    const isDisabled = Boolean(disabled || loading);
    return (
      <button
        ref={ref}
        type={type ?? "button"}
        className={cn(
          "group inline-flex shrink-0 items-center justify-center rounded-control disabled:pointer-events-none",
          hitSize[size ?? "md"],
          className,
        )}
        disabled={isDisabled}
        aria-busy={loading || undefined}
        {...props}
      >
        <span
          className={cn(
            visualVariants({ variant, size }),
            isDisabled &&
              (variant === "inverse" ? "text-paper/40" : "border-divider bg-paper-sunken text-ink-35"),
          )}
        >
          {loading ? <Loader2 className="size-5 animate-spin" aria-hidden="true" /> : children}
        </span>
      </button>
    );
  },
);
IconButton.displayName = "IconButton";
