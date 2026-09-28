import React from "react";
import Link from "next/link";
import { CircleAlert, FileClock } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/shell/container";
import { SectionHeading } from "@/components/public/section-heading";
import { Markdown } from "@/components/public/markdown";

export type LegalDocumentState =
  | { status: "published"; markdown: string | null; version: number; publishedAt: string }
  | { status: "missing" }
  | { status: "error" };

const DATE = new Intl.DateTimeFormat("es-MX", { dateStyle: "long", timeZone: "America/Monterrey" });

/** /legal/* body: the current PUBLISHED version, an honest "en preparación" state, or an error. */
export function LegalDocument({ title, state }: { title: string; state: LegalDocumentState }) {
  return (
    <Container width="reading" className="py-10 sm:py-14 lg:py-20">
      <SectionHeading level="h1" title={title} />
      {state.status === "published" ? (
        <>
          <p className="mt-6 text-body-sm text-ink-60">
            Versión {state.version} · publicada el {DATE.format(new Date(state.publishedAt))}
          </p>
          <article className="mt-8 border-t border-divider pt-8">
            {state.markdown ? (
              <Markdown className="space-y-4 text-body leading-relaxed">{state.markdown}</Markdown>
            ) : (
              <p className="text-body text-ink-80">Este documento se publicó como archivo y todavía no está disponible para lectura en línea.</p>
            )}
          </article>
        </>
      ) : state.status === "missing" ? (
        <div className="mt-10 rounded-card border border-divider bg-paper-raised">
          <EmptyState
            icon={FileClock}
            headingLevel="h2"
            title="Documento en preparación"
            description="Aún no hay una versión publicada de este documento. La encontrarás aquí en cuanto se publique."
            action={
              <Button asChild variant="secondary">
                <Link href="/contacto">Ir a contacto</Link>
              </Button>
            }
          />
        </div>
      ) : (
        <div role="alert" className="mt-10 rounded-card border border-danger-border bg-danger-tint">
          <EmptyState
            icon={CircleAlert}
            headingLevel="h2"
            title="No pudimos cargar el documento"
            description="Es un problema de nuestro lado. Intenta de nuevo en unos momentos."
          />
        </div>
      )}
    </Container>
  );
}
