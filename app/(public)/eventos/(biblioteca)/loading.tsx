import React from "react";
import { Container } from "@/components/shell/container";
import { Skeleton, SkeletonCard, SkeletonGroup } from "@/components/ui/skeleton";

export default function EventosLoading() {
  return (
    <Container className="py-6 lg:py-12">
      <SkeletonGroup label="Cargando eventos">
        <Skeleton className="h-12 w-48 rounded-xs" />
        <Skeleton className="mt-4 h-5 w-full max-w-xl rounded-xs" />
        <div className="mt-10 lg:grid lg:grid-cols-12 lg:gap-8">
          <Skeleton className="hidden h-[32rem] lg:col-span-3 lg:block" />
          <div className="lg:col-span-9">
            <Skeleton className="h-11 w-full rounded-control" />
            <div className="mt-6 grid gap-5 md:grid-cols-2 lg:gap-6">
              {Array.from({ length: 4 }, (_, i) => (
                <SkeletonCard key={i} />
              ))}
            </div>
          </div>
        </div>
      </SkeletonGroup>
    </Container>
  );
}
