import React from "react";
import { cn } from "@/lib/client/cn";

/** ui-spec §3.1 Skeleton: shimmer block matching the real content shape. One live announcement per
 * loading region (SkeletonGroup), not per block -- individual Skeleton pieces are aria-hidden. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("animate-skeleton rounded-card", className)} />;
}

export function SkeletonGroup({
  label = "Cargando",
  children,
  className,
}: {
  label?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div role="status" aria-label={label} className={className}>
      {children}
    </div>
  );
}

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn("h-4 rounded-xs", i === lines - 1 ? "w-2/3" : "w-full")} />
      ))}
    </div>
  );
}

export function SkeletonRow({ columns = 4, className }: { columns?: number; className?: string }) {
  return (
    <div className={cn("flex items-center gap-4 py-3", className)}>
      {Array.from({ length: columns }, (_, i) => (
        <Skeleton key={i} className="h-4 flex-1 rounded-xs" />
      ))}
    </div>
  );
}

export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col gap-3 rounded-card border border-divider p-4", className)}>
      <Skeleton className="aspect-4/3 w-full" />
      <Skeleton className="h-5 w-3/4 rounded-xs" />
      <Skeleton className="h-4 w-1/2 rounded-xs" />
    </div>
  );
}
