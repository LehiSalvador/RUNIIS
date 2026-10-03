"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Clock, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/client/cn";

/**
 * Stale-state indicator for server-rendered operational data. Shows when the data was read and a manual
 * "Actualizar" (router.refresh). After `staleAfterMinutes` without a refresh the line turns into a
 * warning ("pueden haber cambiado") so an operator does not act on a screen left open for an hour. The
 * clock only starts counting on the client (no hydration mismatch); `loadedAt` is the server read time.
 */
export function DataFreshness({
  loadedAt,
  staleAfterMinutes = 5,
  timeZone = "America/Monterrey",
  className,
}: {
  loadedAt: string;
  staleAfterMinutes?: number;
  timeZone?: string;
  className?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [now, setNow] = React.useState<number | null>(null);

  React.useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 30_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [loadedAt]);

  const loaded = new Date(loadedAt);
  const stale = now !== null && now - loaded.getTime() > staleAfterMinutes * 60_000;
  const time = new Intl.DateTimeFormat("es-MX", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone }).format(loaded);

  return (
    <div
      className={cn("flex flex-wrap items-center gap-2 text-caption", stale ? "text-warning" : "text-ink-60", className)}
      data-stale={stale ? "true" : "false"}
    >
      <Clock className="size-3.5" aria-hidden="true" />
      <span role={stale ? "status" : undefined}>
        {stale ? `Datos de las ${time}: pueden haber cambiado.` : `Actualizado a las ${time}`}
      </span>
      <Button variant="ghost" size="sm" loading={pending} onClick={() => startTransition(() => router.refresh())}>
        <RotateCw className="size-4" aria-hidden="true" />
        Actualizar
      </Button>
    </div>
  );
}
