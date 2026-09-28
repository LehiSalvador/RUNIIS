import React from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CalendarCheck, Flag, Search, UserRound, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/shell/container";
import { Wordmark } from "@/components/shell/wordmark";
import { SectionHeading } from "@/components/public/section-heading";
import { JsonLd } from "@/components/public/json-ld";
import { absoluteUrl, breadcrumbJsonLd, pageMetadata } from "@/app/(public)/_lib/seo";

// Copy is limited to what the Master spec states about the product (§4 definition, §5 objective):
// no invented history, figures or claims.
export const metadata: Metadata = pageMetadata({
  title: "Sobre RUNIIS",
  description: "RUNIIS es una plataforma web para publicar, administrar y operar eventos deportivos creados por el propio equipo RUNIIS.",
  path: "/runiis",
});

const SURFACES = [
  { icon: Search, title: "Sitio público", body: "Consulta las carreras, sus modalidades, precios y disponibilidad." },
  { icon: UserRound, title: "Cuenta del participante", body: "Tus inscripciones y tus datos de participante en un solo lugar." },
  { icon: Users, title: "Comunidad", body: "Un espacio para quienes corren en los eventos RUNIIS." },
  { icon: Flag, title: "Día de la carrera", body: "El mismo equipo opera el registro de asistencia en cada evento." },
] as const;

export default function RuniisPage() {
  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Inicio", url: absoluteUrl("/") },
          { name: "Sobre RUNIIS", url: absoluteUrl("/runiis") },
        ])}
      />
      <section className="border-b border-divider">
        <Container className="grid gap-10 py-10 sm:py-14 lg:grid-cols-12 lg:py-20">
          <div className="lg:col-span-8">
            <SectionHeading level="h1" title="Sobre RUNIIS" />
            <p className="mt-8 max-w-2xl font-display text-h3 font-bold leading-tight text-ink sm:text-h2">
              Una plataforma web para publicar, administrar y operar eventos deportivos creados por el propio equipo
              RUNIIS.
            </p>
          </div>
          <div className="flex items-end lg:col-span-4 lg:justify-end">
            <Wordmark size="large" />
          </div>
        </Container>
      </section>

      <section aria-labelledby="que-es" className="py-12 lg:py-20">
        <Container className="grid gap-10 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <h2 id="que-es" className="font-display text-h2 font-bold text-ink">
              Eventos propios, no de terceros
            </h2>
          </div>
          <div className="space-y-4 text-body-lg text-ink-80 lg:col-span-7">
            <p>Cada carrera publicada en RUNIIS la crea y la opera el equipo RUNIIS: la misma gente que la anuncia es la que la organiza el día del evento.</p>
            <p>RUNIIS no es un marketplace de eventos externos ni una plataforma para otros organizadores, y tampoco es una red social general.</p>
          </div>
        </Container>
      </section>

      <section aria-labelledby="superficies" className="border-t border-divider py-12 lg:py-20">
        <Container>
          <h2 id="superficies" className="font-display text-h2 font-bold text-ink">
            Un solo equipo, de principio a fin
          </h2>
          <ul className="mt-8 grid gap-px overflow-hidden rounded-card border border-divider bg-divider sm:grid-cols-2 lg:grid-cols-4">
            {SURFACES.map((item) => (
              <li key={item.title} className="bg-paper-raised p-6">
                <item.icon className="size-7 text-ink-60" aria-hidden="true" />
                <h3 className="mt-4 text-h4 font-bold text-ink">{item.title}</h3>
                <p className="mt-2 text-body-sm text-ink-80">{item.body}</p>
              </li>
            ))}
          </ul>
        </Container>
      </section>

      <section aria-labelledby="objetivo" className="border-t border-divider py-12 lg:py-20">
        <Container className="grid gap-8 lg:grid-cols-12 lg:items-end">
          <div className="lg:col-span-8">
            <CalendarCheck className="size-8 text-ink-60" aria-hidden="true" />
            <h2 id="objetivo" className="mt-4 font-display text-h2 font-bold text-ink">
              Nuestro objetivo
            </h2>
            <p className="mt-4 max-w-2xl text-body-lg text-ink-80">
              Que más personas participen de verdad en los eventos RUNIIS, con menos fricción para inscribirse y para
              operar cada carrera.
            </p>
          </div>
          <div className="lg:col-span-4 lg:text-right">
            <Button asChild size="lg">
              <Link href="/eventos">
                Ver eventos
                <ArrowRight className="size-5" aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </Container>
      </section>
    </>
  );
}
