"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CircleCheck, FileCheck2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/components/ui/use-toast";
import { LegalDocumentButton } from "@/components/registration/legal-document-dialog";
import {
  acceptDocumentsBody,
  acceptanceVersionsKey,
  acceptFailureCopy,
  editionDocumentsPath,
  type EditionAcceptanceEdition,
  type EditionAcceptanceItem,
} from "@/components/account/logic/edition-documents";
import { apiFetch } from "@/lib/client/api";
import { LEGAL_DOCUMENT_LABELS } from "@/lib/client/account-format";

function docTitle(documentType: string): string {
  return LEGAL_DOCUMENT_LABELS[documentType] ?? "Documento del evento";
}

function subjectHeading(item: EditionAcceptanceItem): string {
  if (item.subject.kind === "SELF") return "Tus documentos";
  return `Documentos de ${item.subject.display_name ?? "el menor a tu cargo"}`;
}

function subjectLead(item: EditionAcceptanceItem): string {
  if (item.subject.kind === "SELF") return "Aceptas tú, personalmente: nadie puede aceptar estos documentos por ti.";
  return `${item.subject.display_name ?? "La persona"} es menor de edad. Aceptas como su responsable, y la aceptación queda registrada a su nombre.`;
}

function ItemCard({ edition, item, onAccepted }: { edition: EditionAcceptanceEdition; item: EditionAcceptanceItem; onAccepted: (key: string) => void }) {
  const router = useRouter();
  const versionsKey = acceptanceVersionsKey(item);
  // One explicit tick per document version, never pre-ticked. A tick belongs to the versions on screen.
  const [ticked, setTicked] = React.useState<{ versionsKey: string; ids: ReadonlySet<string> }>({ versionsKey, ids: new Set() });
  const [pending, setPending] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const [failure, setFailure] = React.useState<ReturnType<typeof acceptFailureCopy> | null>(null);
  const headingId = `edition-docs-${item.key.replace(/[^A-Za-z0-9_-]/g, "_")}`;

  const tickedIds = ticked.versionsKey === versionsKey ? ticked.ids : new Set<string>();
  const allTicked = item.documents.every((document) => tickedIds.has(document.legal_document_version_id));

  function toggle(versionId: string, checked: boolean) {
    const next = new Set(tickedIds);
    if (checked) next.add(versionId);
    else next.delete(versionId);
    setTicked({ versionsKey, ids: next });
  }

  async function accept() {
    if (!allTicked || pending) return;
    setPending(true);
    setFailure(null);
    const result = await apiFetch<{ edition_id: string; missing_document_version_ids: string[] }>("/api/v1/me/pending-actions/accept-documents", {
      method: "POST",
      body: acceptDocumentsBody(edition.edition_id, item),
    });
    setPending(false);
    if (!result.ok) {
      setFailure(acceptFailureCopy(result));
      return;
    }
    if (result.data.missing_document_version_ids.length > 0) {
      // The server still misses something (a version moved meanwhile): read again instead of claiming success.
      setFailure({ text: "Todavía falta aceptar algún documento. Actualiza la página, léelos y acepta de nuevo.", refresh: true, signIn: false });
      return;
    }
    setDone(true);
    onAccepted(item.key);
    toast({ tone: "success", title: "Documentos aceptados", description: edition.name });
  }

  if (done) {
    return (
      <section aria-labelledby={headingId} className="flex flex-col gap-2 rounded-card border border-success-border bg-success-tint p-4 sm:p-5" data-testid="edition-docs-done" data-subject={item.key}>
        <h3 id={headingId} className="flex items-center gap-2 text-h4 font-bold text-ink">
          <CircleCheck className="size-5 text-success" aria-hidden="true" />
          {item.subject.kind === "SELF" ? "Aceptaste tus documentos" : `Aceptaste los documentos de ${item.subject.display_name ?? "el menor a tu cargo"}`}
        </h3>
        <p className="text-body-sm text-ink-80">Quedó registrada la versión vigente de cada documento con la fecha de hoy.</p>
      </section>
    );
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4 rounded-card border border-divider bg-paper-raised p-4 sm:p-5" data-testid="edition-docs-card" data-subject={item.key}>
      <div>
        <h3 id={headingId} className="text-h4 font-bold text-ink">
          {subjectHeading(item)}
        </h3>
        <p className="mt-1 text-body-sm text-ink-60">{subjectLead(item)}</p>
      </div>
      <ul className="flex flex-col" aria-label="Documentos por aceptar">
        {item.documents.map((document) => {
          const title = docTitle(document.document_type);
          const id = `edition-doc-${item.key.replace(/[^A-Za-z0-9_-]/g, "_")}-${document.legal_document_version_id}`;
          return (
            <li key={document.legal_document_version_id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-divider first:border-t-0">
              <Checkbox
                id={id}
                checked={tickedIds.has(document.legal_document_version_id)}
                onCheckedChange={(next) => toggle(document.legal_document_version_id, next === true)}
                label={item.subject.kind === "SELF" ? `Leí y acepto: ${title} (versión ${document.version})` : `Leí y acepto como responsable: ${title} (versión ${document.version})`}
              />
              <LegalDocumentButton documentKey={document.document_key} title={title} version={document.version} />
            </li>
          );
        })}
      </ul>
      {failure ? (
        <Alert
          tone="danger"
          title="No pudimos registrar la aceptación"
          action={
            failure.signIn ? (
              <Button asChild size="sm">
                <Link href={`/entrar?next=${encodeURIComponent(editionDocumentsPath(edition.slug))}`}>Iniciar sesión</Link>
              </Button>
            ) : failure.refresh ? (
              <Button variant="secondary" size="sm" onClick={() => router.refresh()}>
                Actualizar documentos
              </Button>
            ) : undefined
          }
        >
          {failure.text}
        </Alert>
      ) : null}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button onClick={accept} loading={pending} disabled={!allTicked} className="w-full sm:w-auto">
          <FileCheck2 className="size-5" aria-hidden="true" />
          Aceptar documentos
        </Button>
        <p className="text-caption text-ink-60">Marca cada documento para poder aceptar.</p>
      </div>
    </section>
  );
}

/**
 * Master §124 for a FREE edition (confirmation is immediate): the adult Friend, or the guardian of a minor, accepts the event
 * documents here BEFORE the buyer submits. Reached from the buyer's "Copiar enlace" (deep link with the edition slug) and from
 * the account. Acceptance is one explicit tick per document version; the buyer's flow reads it back on "Ya aceptó, actualizar".
 */
export function EditionDocuments({
  edition,
  items,
  registrationOpen,
}: {
  edition: EditionAcceptanceEdition;
  items: EditionAcceptanceItem[];
  registrationOpen: boolean;
}) {
  // What this screen listed on arrival: accepted cards stay as confirmation instead of vanishing.
  const [shown] = React.useState(items);
  const [accepted, setAccepted] = React.useState<ReadonlySet<string>>(new Set());
  const allDone = shown.length > 0 && accepted.size === shown.length;

  return (
    <section aria-labelledby="edition-docs-heading" className="flex max-w-[var(--container-reading)] flex-col gap-5" data-testid="edition-documents">
      <div>
        <h2 id="edition-docs-heading" className="font-display text-h3 font-bold text-ink">
          {edition.name}
        </h2>
        <p className="mt-1 text-body text-ink-80">
          Antes de que se confirme una inscripción, cada persona adulta acepta sus documentos del evento desde su propia cuenta, y los menores de edad los acepta su responsable.
        </p>
      </div>

      {!registrationOpen ? (
        <Alert tone="info" title="Las inscripciones de este evento no están abiertas">
          Cuando abran podrás aceptar los documentos aquí.
        </Alert>
      ) : null}

      {shown.length === 0 ? (
        <Alert tone="success" title="No tienes documentos pendientes de este evento">
          Si alguien te inscribirá, avísale que ya puede enviar. Si no esperas una inscripción, no tienes nada más que hacer aquí.
        </Alert>
      ) : (
        shown.map((item) => (
          <ItemCard key={item.key} edition={edition} item={item} onAccepted={(key) => setAccepted((current) => new Set(current).add(key))} />
        ))
      )}

      {allDone ? (
        <p className="text-body-sm text-ink-80" role="status">
          Listo. Avísale a quien te inscribe: en su inscripción debe pulsar <span className="font-semibold">Ya aceptó, actualizar</span>.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-x-5 gap-y-1">
        <Link href={`/eventos/${edition.slug}`} className="inline-flex min-h-11 items-center text-button font-semibold text-ink underline decoration-divider underline-offset-8 hover:decoration-ink">
          Ver el evento
        </Link>
        <Link href="/cuenta" className="inline-flex min-h-11 items-center text-button font-semibold text-ink underline decoration-divider underline-offset-8 hover:decoration-ink">
          Ir a mi cuenta
        </Link>
      </div>
    </section>
  );
}
