"use client";

import React from "react";
import Link from "next/link";
import { CircleAlert, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/shell/container";

/** Whole-page failure of the registration builder: a retry, never a stack trace or an empty page. */
export default function RegistrationError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  React.useEffect(() => headingRef.current?.focus(), []);

  return (
    <Container width="registration" className="py-10 sm:py-16">
      <div role="alert" className="max-w-2xl rounded-panel border border-danger-border bg-danger-tint p-6 sm:p-8">
        <CircleAlert className="size-9 text-danger" aria-hidden="true" />
        <h1 ref={headingRef} tabIndex={-1} className="mt-4 font-display text-h2 font-bold text-ink outline-none">
          No pudimos cargar la inscripción
        </h1>
        <p className="mt-3 text-body text-ink-80">Es un problema de nuestro lado. Lo que ya enviaste no se perdió; intenta de nuevo en unos momentos.</p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Button onClick={reset}>
            <RotateCcw className="size-4" aria-hidden="true" />
            Reintentar
          </Button>
          <Button asChild variant="secondary">
            <Link href="/eventos">Ver eventos</Link>
          </Button>
        </div>
      </div>
    </Container>
  );
}
