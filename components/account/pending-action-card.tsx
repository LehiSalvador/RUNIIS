"use client";

import React from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/use-toast";
import { ConfirmDialog } from "@/components/account/confirm-dialog";
import { apiFetch } from "@/lib/client/api";
import { LEGAL_DOCUMENT_LABELS } from "@/lib/client/account-format";
import type { PendingActionView } from "@/lib/client/account-types";
import { loadActionDocumentTexts, type LegalText } from "@/components/account/logic/pending-action-documents";

// react-markdown only loads when someone opens a document dialog.
const Markdown = dynamic(() => import("@/components/public/markdown").then((module) => module.Markdown));

function subjectLabel(action: PendingActionView): string {
  if (action.subject.kind === "SELF") return "Para ti";
  return `Para ${action.subject.display_name ?? "el menor a tu cargo"} (menor de edad)`;
}

/**
 * Master §124 pending action: this person (or the minor they are responsible for) still has to
 * accept an Edition's current documents. Accepting is the person's own act -- a buyer never sees a
 * checkbox for someone else. The dialog shows each document's current text when the public legal
 * endpoint serves that exact version, read by the document's own key (the Edition's rules have a per-Edition key).
 */
export function PendingActionCard({ action }: { action: PendingActionView }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [agreed, setAgreed] = React.useState(false);
  const [texts, setTexts] = React.useState<Record<string, LegalText>>({});

  React.useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    loadActionDocumentTexts(
      action,
      apiFetch,
      (versionId, text) => setTexts((current) => ({ ...current, [versionId]: text })),
      controller.signal,
    ).catch(() => undefined);
    return () => controller.abort();
  }, [open, action]);

  async function accept() {
    const body: Record<string, unknown> = {
      edition_id: action.edition.edition_id,
      legal_document_version_ids: action.documents.map((document) => document.legal_document_version_id),
    };
    if (action.subject.kind === "MINOR_PROFILE" && action.subject.public_profile_id) body.minor_public_profile_id = action.subject.public_profile_id;
    if (action.subject.kind === "MINOR_GUEST") body.minor_guest_participant_id = action.subject.guest_participant_id;
    const result = await apiFetch("/api/v1/me/pending-actions/accept-documents", { method: "POST", body });
    if (!result.ok) return result;
    toast({ tone: "success", title: "Documentos aceptados", description: action.edition.name });
    router.refresh();
    return null;
  }

  return (
    <li className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between" data-testid="pending-action">
      <div className="flex min-w-0 gap-3">
        <FileText className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-body font-bold text-ink">Acepta los documentos de {action.edition.name}</p>
          <p className="text-body-sm text-ink-60">{subjectLabel(action)}</p>
          <ul className="mt-2 flex flex-col gap-0.5 text-body-sm text-ink-80">
            {action.documents.map((document) => (
              <li key={document.legal_document_version_id}>
                {LEGAL_DOCUMENT_LABELS[document.document_type] ?? document.document_type} · versión {document.version}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <Button
        variant="primary"
        onClick={() => {
          setAgreed(false);
          setOpen(true);
        }}
        className="w-full shrink-0 sm:w-auto"
      >
        Revisar y aceptar
      </Button>

      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        tone="primary"
        title={`Documentos de ${action.edition.name}`}
        description={`${subjectLabel(action)}. Lee cada documento; al aceptar quedará registrada la versión vigente.`}
        confirmLabel="Aceptar documentos"
        onConfirm={async () => {
          if (!agreed) {
            return { ok: false, status: 0, code: "VALIDATION_ERROR", message: "", requestId: null, details: {} };
          }
          return accept();
        }}
        describeFailure={(failure) =>
          failure.code === "VALIDATION_ERROR" && failure.status === 0
            ? "Marca la casilla para confirmar que leíste los documentos."
            : failure.code === "CONFLICT" || failure.code === "RESOURCE_EXPIRED"
              ? "Los documentos cambiaron. Cierra y vuelve a revisarlos."
              : "No pudimos registrar tu aceptación. Intenta de nuevo."
        }
      >
        <div className="flex flex-col gap-4">
          {action.documents.map((document) => {
            const text = texts[document.legal_document_version_id];
            return (
              <section key={document.legal_document_version_id} className="rounded-card border border-divider">
                <h3 className="border-b border-divider px-4 py-3 text-body font-bold text-ink">
                  {LEGAL_DOCUMENT_LABELS[document.document_type] ?? document.document_type}{" "}
                  <span className="font-normal text-ink-60">· versión {document.version}</span>
                </h3>
                <div className="max-h-48 overflow-y-auto px-4 py-3" tabIndex={0} aria-label={`Texto de ${LEGAL_DOCUMENT_LABELS[document.document_type] ?? document.document_type}`}>
                  {!text ? (
                    <Skeleton className="h-16 w-full" />
                  ) : text.status === "ready" ? (
                    <Markdown className="text-body-sm">{text.markdown}</Markdown>
                  ) : (
                    <p className="text-body-sm text-ink-60">
                      Este documento no está disponible para lectura aquí. Pide el texto al organizador antes de aceptarlo.
                    </p>
                  )}
                </div>
              </section>
            );
          })}
          <Checkbox id={`accept-${action.edition.edition_id}-${action.subject.kind}`} checked={agreed} onCheckedChange={(value) => setAgreed(value === true)} label="Leí y acepto estos documentos" />
        </div>
      </ConfirmDialog>
    </li>
  );
}
