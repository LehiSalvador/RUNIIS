import React from "react";
import { Skeleton, SkeletonGroup, SkeletonRow } from "@/components/ui/skeleton";

/**
 * Loading states for admin data regions. Pages render their shell immediately and wrap each data region in
 * <Suspense fallback={...}> with one of these, so the operator sees structure (not a blank page) while the
 * server reads. There is deliberately no route-level loading.tsx under /admin: a loading boundary would turn
 * the unauthenticated redirect into a 200 + meta refresh (AUD-033); the guard runs before any Suspense.
 */
export function TableSkeleton({ rows = 6, columns = 6, label = "Cargando tabla" }: { rows?: number; columns?: number; label?: string }) {
  return (
    <SkeletonGroup label={label} className="overflow-hidden rounded-card border border-divider bg-paper-raised px-4">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="border-b border-divider last:border-b-0">
          <SkeletonRow columns={columns} />
        </div>
      ))}
    </SkeletonGroup>
  );
}

export function TilesSkeleton({ count = 4, label = "Cargando indicadores" }: { count?: number; label?: string }) {
  return (
    <SkeletonGroup label={label} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="rounded-card border border-divider bg-paper-raised p-4">
          <Skeleton className="h-4 w-1/2 rounded-xs" />
          <Skeleton className="mt-3 h-8 w-1/3" />
        </div>
      ))}
    </SkeletonGroup>
  );
}

export function PanelsSkeleton({ count = 3, label = "Cargando detalle" }: { count?: number; label?: string }) {
  return (
    <SkeletonGroup label={label} className="grid gap-4 lg:grid-cols-2">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="flex flex-col gap-3 rounded-card border border-divider bg-paper-raised p-4">
          <Skeleton className="h-5 w-1/3 rounded-xs" />
          <Skeleton className="h-4 w-full rounded-xs" />
          <Skeleton className="h-4 w-5/6 rounded-xs" />
          <Skeleton className="h-4 w-2/3 rounded-xs" />
        </div>
      ))}
    </SkeletonGroup>
  );
}
