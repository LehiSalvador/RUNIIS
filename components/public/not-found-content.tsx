import React from "react";
import Link from "next/link";
import { ArrowRight, MapPinOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/shell/container";
import { Runline } from "@/components/ui/runline";

export function NotFoundContent() {
  return (
    <Container className="flex flex-col items-start py-16 sm:py-24 lg:py-32">
      <MapPinOff className="size-11 text-ink-60" aria-hidden="true" />
      <p className="mt-6 font-display text-display-xl font-bold leading-none tabular-nums text-ink" aria-hidden="true">
        404
      </p>
      <h1 className="mt-4 font-display text-h1 font-bold text-ink">Esta página no existe</h1>
      <Runline weight="strong" className="mt-4 w-16" />
      <p className="mt-6 max-w-lg text-body-lg text-ink-80">
        Puede que la dirección esté mal escrita o que la página ya no esté disponible. Las carreras publicadas siguen en la
        biblioteca de eventos.
      </p>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <Button asChild size="lg">
          <Link href="/eventos">
            Ver eventos
            <ArrowRight className="size-5" aria-hidden="true" />
          </Link>
        </Button>
        <Button asChild size="lg" variant="secondary">
          <Link href="/">Ir al inicio</Link>
        </Button>
      </div>
    </Container>
  );
}
