"use client";

import React from "react";
import { FileText } from "lucide-react";
import { Markdown } from "@/components/public/markdown";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal, ModalActions, ModalClose, ModalContent } from "@/components/ui/modal";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/client/api";
import { useReturnFocus } from "@/lib/client/focus";

type PublicDocument = { document_key: string; document_type: string; legal_document_version_id: string; version: number; content_markdown: string | null; public_asset_key: string | null; published_at: string };

type State = { status: "idle" } | { status: "loading" } | { status: "ready"; document: PublicDocument } | { status: "error" };

/**
 * "Leer documento": the public text of the version the buyer is about to accept (GET /api/v1/legal/:key, public).
 * Nothing is accepted here; acceptance is always the checkbox next to the link.
 */
export function LegalDocumentButton({ documentKey, title, version }: { documentKey: string; title: string; version: number }) {
  const [open, setOpen] = React.useState(false);
  const [state, setState] = React.useState<State>({ status: "idle" });
  const returnFocus = useReturnFocus(open);

  const load = React.useCallback(async () => {
    setState({ status: "loading" });
    const result = await apiFetch<PublicDocument>(`/api/v1/legal/${encodeURIComponent(documentKey)}`);
    setState(result.ok ? { status: "ready", document: result.data } : { status: "error" });
  }, [documentKey]);

  function change(next: boolean) {
    setOpen(next);
    if (next && state.status !== "ready" && state.status !== "loading") void load();
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => change(true)} className="shrink-0 underline underline-offset-4">
        <FileText className="size-4" aria-hidden="true" />
        Leer<span className="sr-only"> {title}</span>
      </Button>
      <Modal open={open} onOpenChange={change}>
        <ModalContent title={title} description={`Versión ${version}`} onCloseAutoFocus={returnFocus} widthClassName="max-w-[var(--container-reading)]">
          <div className="max-h-[50dvh] overflow-y-auto rounded-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" tabIndex={0} role="region" aria-label={`Texto de ${title}`} data-testid="legal-document-text">
            {state.status === "loading" || state.status === "idle" ? (
              <SkeletonGroup label="Cargando documento" className="flex flex-col gap-3">
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-5/6" />
              </SkeletonGroup>
            ) : state.status === "error" ? (
              <Alert
                tone="danger"
                title="No pudimos cargar el documento."
                action={
                  <Button variant="secondary" size="sm" onClick={() => void load()}>
                    Reintentar
                  </Button>
                }
              >
                Revisa tu conexión e intenta de nuevo.
              </Alert>
            ) : state.document.content_markdown ? (
              <Markdown>{state.document.content_markdown}</Markdown>
            ) : (
              <p className="text-body text-ink-80">Este documento se publicó como archivo y todavía no está disponible para lectura en línea.</p>
            )}
          </div>
          <ModalActions>
            <ModalClose asChild>
              <Button variant="secondary">Cerrar</Button>
            </ModalClose>
          </ModalActions>
        </ModalContent>
      </Modal>
    </>
  );
}
