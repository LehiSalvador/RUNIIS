import React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/client/cn";
import { IconButton } from "@/components/ui/icon-button";
import { Button } from "@/components/ui/button";

/** ui-spec §3.1 Pagination: prev/next IconButton + display-num page indicator (offset pagination,
 * public library), or cursor-based "Cargar más" (admin large tables). Current page announced. */
export type OffsetPaginationProps = {
  variant?: "offset";
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  className?: string;
};

export type CursorPaginationProps = {
  variant: "cursor";
  hasMore: boolean;
  loading?: boolean;
  onLoadMore: () => void;
  className?: string;
};

export function Pagination(props: OffsetPaginationProps | CursorPaginationProps) {
  if (props.variant === "cursor") {
    const { hasMore, loading, onLoadMore, className } = props;
    if (!hasMore) return null;
    return (
      <div className={cn("flex justify-center", className)}>
        <Button variant="secondary" loading={loading} onClick={onLoadMore}>
          Cargar más
        </Button>
      </div>
    );
  }

  const { page, pageCount, onPageChange, className } = props;

  return (
    <nav aria-label="Paginación" className={cn("flex items-center justify-center gap-4", className)}>
      <IconButton
        aria-label="Página anterior"
        variant="ghost"
        size="sm"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        <ChevronLeft className="size-5" aria-hidden="true" />
      </IconButton>
      <p aria-live="polite" className="min-w-16 text-center font-display text-h4 font-bold tabular-nums text-ink">
        <span className="sr-only">
          Página {page} de {pageCount}
        </span>
        <span aria-hidden="true">
          {page} <span className="font-body text-body-sm font-normal text-ink-60">/ {pageCount}</span>
        </span>
      </p>
      <IconButton
        aria-label="Página siguiente"
        variant="ghost"
        size="sm"
        disabled={page >= pageCount}
        onClick={() => onPageChange(page + 1)}
      >
        <ChevronRight className="size-5" aria-hidden="true" />
      </IconButton>
    </nav>
  );
}
