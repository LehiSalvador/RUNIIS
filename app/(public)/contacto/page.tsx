import React from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CalendarSearch, FileText, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/shell/container";
import { SectionHeading } from "@/components/public/section-heading";
import { JsonLd } from "@/components/public/json-ld";
import { absoluteUrl, breadcrumbJsonLd, pageMetadata } from "@/app/(public)/_lib/seo";

// The platform-wide contact channel lives in platform settings, which have no public read yet; until
// then this page states that honestly and points to the per-Edition channel each Event page shows.
export const metadata: Metadata = pageMetadata({
  title: "Contacto",
  description: "Cómo contactar al equipo RUNIIS: cada evento muestra su propio canal de contacto.",
  path: "/contacto",
});

export default function ContactoPage() {
  return (
    <Container className="py-10 sm:py-14 lg:py-20">
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Inicio", url: absoluteUrl("/") },
          { name: "Contacto", url: absoluteUrl("/contacto") },
        ])}
      />
      <SectionHeading
        level="h1"
        title="Contacto"
        description="Estamos para ayudarte con tus dudas sobre carreras e inscripciones."
      />

      <div className="mt-10 grid gap-5 lg:mt-14 lg:grid-cols-3">
        <section aria-labelledby="canal-general" className="flex flex-col rounded-panel border border-divider bg-paper-raised p-6 lg:col-span-2 lg:p-8">
          <MessageCircle className="size-8 text-ink-60" aria-hidden="true" />
          <h2 id="canal-general" className="mt-4 font-display text-h3 font-bold text-ink">
            Canal general de contacto
          </h2>
          <p className="mt-3 max-w-xl text-body text-ink-80">
            El canal general de contacto de RUNIIS está en configuración. Mientras tanto, para una duda sobre una carrera,
            usa el contacto que aparece en la página de ese evento.
          </p>
        </section>

        <section aria-labelledby="por-evento" className="flex flex-col rounded-panel bg-ink p-6 text-paper surface-ink lg:p-8">
          <CalendarSearch className="size-8 text-lime" aria-hidden="true" />
          <h2 id="por-evento" className="mt-4 font-display text-h3 font-bold text-paper">
            Dudas sobre un evento
          </h2>
          <p className="mt-3 text-body text-paper/80">Cada página de evento incluye su sección de contacto, con WhatsApp cuando está disponible.</p>
          <Link
            href="/eventos"
            className="mt-6 inline-flex h-12 items-center justify-center gap-2 self-start rounded-control bg-lime px-5 text-button font-semibold text-ink transition-colors duration-fast ease-standard hover:bg-lime-soft"
          >
            Ver eventos
            <ArrowRight className="size-5" aria-hidden="true" />
          </Link>
        </section>
      </div>

      <section aria-labelledby="documentos" className="mt-12 border-t border-divider pt-10">
        <h2 id="documentos" className="font-display text-h3 font-bold text-ink">
          Documentos legales
        </h2>
        <ul className="mt-5 flex flex-col gap-3 sm:flex-row">
          {[
            { href: "/legal/terminos", label: "Términos y condiciones" },
            { href: "/legal/privacidad", label: "Aviso de privacidad" },
          ].map((doc) => (
            <li key={doc.href}>
              <Button asChild variant="secondary">
                <Link href={doc.href}>
                  <FileText className="size-4" aria-hidden="true" />
                  {doc.label}
                </Link>
              </Button>
            </li>
          ))}
        </ul>
      </section>
    </Container>
  );
}
