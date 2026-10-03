"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { Container } from "@/components/shell/container";
import { Button } from "@/components/ui/button";
import { legalDocumentsPhrase, pendingLegalDocuments, type AccountLegalDocument } from "@/components/account/logic/legal";

export const LEGAL_ACCEPTANCE_PATH = "/cuenta/documentos";

/**
 * Account-area banner (OWN-05): shown on every /cuenta page while a TERMS_OF_SERVICE / PRIVACY_NOTICE version is not accepted.
 * It cannot be dismissed (it disappears only once the person accepts) and never accepts anything by itself.
 */
export function LegalBanner({ documents, reacceptance }: { documents: readonly AccountLegalDocument[]; reacceptance: boolean }) {
  const pathname = usePathname();
  const pending = pendingLegalDocuments(documents);
  if (pending.length === 0 || pathname === LEGAL_ACCEPTANCE_PATH) return null;
  const href = `${LEGAL_ACCEPTANCE_PATH}?next=${encodeURIComponent(pathname || "/cuenta")}`;

  return (
    <section aria-label="Documentos legales pendientes" className="border-b border-warning-border bg-warning-tint" data-testid="legal-banner">
      <Container className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-start gap-2 text-body-sm text-ink">
          <TriangleAlert className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden="true" />
          <span>
            <span className="font-semibold">{reacceptance ? "Actualizamos tus documentos legales." : "Falta aceptar tus documentos legales."}</span>{" "}
            Para inscribirte necesitas aceptar {legalDocumentsPhrase(pending)}.
          </span>
        </p>
        <Button asChild size="sm" className="w-full shrink-0 sm:w-auto">
          <Link href={href}>Revisar y aceptar</Link>
        </Button>
      </Container>
    </section>
  );
}
