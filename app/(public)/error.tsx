"use client";

import React from "react";
import Link from "next/link";
import { CircleAlert, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/shell/container";

/** Public error boundary: a loading failure is never shown as an empty state (Master §56). */
export default function PublicError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  React.useEffect(() => headingRef.current?.focus(), []);

  return (
    <Container className="py-16 sm:py-24">
      <div role="alert" className="max-w-2xl rounded-panel border border-danger-border bg-danger-tint p-6 sm:p-8">
        <CircleAlert className="size-9 text-danger" aria-hidden="true" />
        <h1 ref={headingRef} tabIndex={-1} className="mt-4 font-display text-h2 font-bold text-ink outline-none">
          No pudimos cargar esta página
        </h1>
        <p className="mt-3 text-body text-ink-80">Es un problema de nuestro lado, no de tu conexión. Intenta de nuevo en unos momentos.</p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Button onClick={reset}>
            <RotateCcw className="size-4" aria-hidden="true" />
            Reintentar
          </Button>
          <Button asChild variant="secondary">
            <Link href="/">Ir al inicio</Link>
          </Button>
        </div>
      </div>
    </Container>
  );
}
