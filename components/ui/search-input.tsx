"use client";

import React from "react";
import { Loader2, Search, X } from "lucide-react";
import { cn } from "@/lib/client/cn";

/** ui-spec §3.1 SearchInput: leading search icon (a spinner while a query is in flight), trailing
 * 44px clear button once there is a value; clearing returns focus to the field. type=search gives
 * the searchbox role; the caller announces the result count in its own live region. */
export type SearchInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> & {
  loading?: boolean;
  onClear?: () => void;
};

export const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(
  ({ className, loading, onClear, value, ...props }, ref) => {
    const localRef = React.useRef<HTMLInputElement | null>(null);

    return (
      <div className="relative flex items-center">
        <span className="pointer-events-none absolute left-3 flex size-5 items-center justify-center text-ink-60">
          {loading ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Search className="size-4" aria-hidden="true" />
          )}
        </span>
        <input
          ref={(node) => {
            localRef.current = node;
            if (typeof ref === "function") ref(node);
            else if (ref) ref.current = node;
          }}
          type="search"
          value={value}
          className={cn(
            "h-11 w-full rounded-control border border-control bg-paper-raised pl-10 pr-11 text-body text-ink placeholder:text-ink-60 transition-colors duration-fast ease-standard hover:border-ink-60 focus-visible:border-ink [&::-webkit-search-cancel-button]:appearance-none",
            className,
          )}
          {...props}
        />
        {value && onClear ? (
          <button
            type="button"
            aria-label="Limpiar búsqueda"
            onClick={() => {
              onClear();
              localRef.current?.focus();
            }}
            className="absolute right-0 flex size-11 items-center justify-center rounded-control text-ink-60 hover:text-ink"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>
    );
  },
);
SearchInput.displayName = "SearchInput";
