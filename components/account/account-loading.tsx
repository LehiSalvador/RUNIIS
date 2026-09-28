import React from "react";
import { AccountShell } from "@/components/shell/account-shell";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";

/** Route-level loading state for /cuenta/* (loading.tsx): the shell stays put, content shimmers. */
export function AccountLoading({ title, rows = 3 }: { title: string; rows?: number }) {
  return (
    <AccountShell pageTitle={title}>
      <SkeletonGroup label={`Cargando ${title.toLowerCase()}`} className="flex flex-col gap-6">
        <Skeleton className="h-8 w-48" />
        <div className="flex flex-col divide-y divide-divider rounded-card border border-divider bg-paper-raised">
          {Array.from({ length: rows }, (_, index) => (
            <div key={index} className="flex items-center gap-4 p-5">
              <Skeleton className="size-12 shrink-0 rounded-full" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
          ))}
        </div>
      </SkeletonGroup>
    </AccountShell>
  );
}
