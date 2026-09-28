import React from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Runline } from "@/components/ui/runline";
import { Container } from "@/components/shell/container";

/**
 * Interim Home: only the first block of the ui-spec §4.1 order (hero), without imagery or invented
 * content -- the full Home (próximas carreras, biblioteca, comunidad y podio, ...) is a later task.
 */
export default function Page() {
  return (
    <section className="border-b border-divider">
      <Container className="py-12 sm:py-16 lg:py-24">
        <h1 className="max-w-4xl font-display text-display-xl font-bold text-ink">
          Descubre carreras, inscríbete y consulta tu ranking verificado.
        </h1>
        <Runline weight="strong" className="mt-6 w-24" />
        <p className="mt-6 max-w-xl text-body-lg text-ink-80">
          Encuentra tu próxima carrera, arma tu inscripción con amigos e invitados y sigue tus
          kilómetros verificados.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Button asChild size="lg">
            <Link href="/eventos">
              Ver próximas carreras
              <ArrowRight className="size-5" aria-hidden="true" />
            </Link>
          </Button>
          <Button asChild size="lg" variant="secondary">
            <Link href="/ranking">Ver ranking</Link>
          </Button>
        </div>
      </Container>
    </section>
  );
}
