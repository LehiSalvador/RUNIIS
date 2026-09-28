import React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/client/cn";

/**
 * ui-spec §3.1 shared interactive-state recipe + Button row: default border/fill per variant, hover
 * darkens border to ink-60, focus-visible always shows the Section 2.8 ring, active shifts fill,
 * loading swaps the label for a spinner at the same width (aria-busy, no layout shift), disabled is
 * ink-35/paper-sunken and exempt from contrast.
 */
export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-control border text-button font-body font-semibold transition-colors duration-fast ease-standard disabled:pointer-events-none disabled:cursor-not-allowed disabled:border-divider disabled:bg-paper-sunken disabled:text-ink-35 aria-disabled:pointer-events-none aria-disabled:cursor-not-allowed aria-disabled:border-divider aria-disabled:bg-paper-sunken aria-disabled:text-ink-35",
  {
    variants: {
      variant: {
        primary: "border-ink bg-ink text-paper hover:border-ink-80 hover:bg-ink-80 active:bg-ink",
        secondary:
          "border-control bg-paper-raised text-ink hover:border-ink-60 active:bg-paper-sunken",
        ghost: "border-transparent bg-transparent text-ink hover:border-control active:bg-paper-sunken",
        danger: "border-danger bg-danger text-paper hover:opacity-90 active:opacity-100",
      },
      size: {
        // 36px visual, 44px hit area via an invisible pseudo-element (ui-spec §3.1 touch-target rule).
        sm: "relative h-9 px-3 text-body-sm after:absolute after:inset-x-0 after:-inset-y-1 after:content-['']",
        md: "h-11 px-4",
        lg: "h-13 px-6 text-body",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    loading?: boolean;
  };

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, disabled, children, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size, className }))}
        disabled={asChild ? undefined : Boolean(disabled || loading)}
        aria-busy={(loading && !asChild) || undefined}
        {...props}
      >
        {loading && !asChild ? (
          <span className="relative inline-flex items-center justify-center">
            <Loader2
              className="absolute inset-0 m-auto size-4 animate-spin"
              aria-hidden="true"
            />
            {/* opacity-0, not `invisible` (visibility:hidden) or `hidden` -- both of those remove
                text from the accessibility tree, leaving a loading button with no accessible name
                (axe: button-name). opacity-0 keeps it in the tree while hiding it visually. */}
            <span className="opacity-0">{children}</span>
          </span>
        ) : (
          children
        )}
      </Comp>
    );
  },
);
Button.displayName = "Button";
