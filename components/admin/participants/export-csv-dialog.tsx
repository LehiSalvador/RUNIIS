"use client";

import React from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal, ModalActions, ModalClose, ModalContent, ModalTrigger } from "@/components/ui/modal";
import { toast } from "@/components/ui/use-toast";
import { toApiResult, type ApiFailure } from "@/lib/client/api";
import { ErrorNoticeView } from "@/components/admin/error-notice";
import { describeFailure } from "@/components/admin/errors";
import { TextareaField } from "@/components/admin/events/fields";
import { csvFileName, exportQuery, validateExportReason } from "@/components/admin/participants/participant-logic";

/**
 * CSV export of the participants (contains contact data, so it is a PII export). Rendered only when the API said the viewer holds that
 * permission (`meta.contact_visible`), and the server still decides: it requires the explicit permission and a reason, and audits the row
 * count. The file is fetched here so a refusal (403, 429, 400) is shown as the actionable error instead of a JSON page; a success is only
 * announced after the bytes arrived.
 */
export function ExportCsvDialog({ editionId, filters }: { editionId: string; filters: Record<string, string | undefined> }) {
  const [open, setOpen] = React.useState(false);
  const pendingRef = React.useRef(false);
  return (
    <Modal open={open} onOpenChange={(next) => (pendingRef.current ? undefined : setOpen(next))}>
      <ModalTrigger asChild>
        <Button variant="secondary" size="sm">
          <Download className="size-4" aria-hidden="true" />
          Exportar CSV
        </Button>
      </ModalTrigger>
      <ModalContent
        title="Exportar participantes a CSV"
        description="El archivo incluye teléfonos y contactos de emergencia. Respeta los filtros activos."
      >
        {open ? <ExportForm editionId={editionId} filters={filters} pendingRef={pendingRef} onClose={() => setOpen(false)} /> : null}
      </ModalContent>
    </Modal>
  );
}

function ExportForm({
  editionId,
  filters,
  pendingRef,
  onClose,
}: {
  editionId: string;
  filters: Record<string, string | undefined>;
  pendingRef: React.MutableRefObject<boolean>;
  onClose: () => void;
}) {
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const [failure, setFailure] = React.useState<ApiFailure | null>(null);

  async function submit(event?: React.FormEvent) {
    event?.preventDefault();
    if (pendingRef.current) return;
    const invalid = validateExportReason(reason);
    setError(invalid);
    if (invalid) return;
    pendingRef.current = true;
    setPending(true);
    setFailure(null);
    try {
      let response: Response;
      try {
        response = await fetch(`/api/v1/admin/editions/${editionId}/participants/export.csv?${exportQuery(filters, reason)}`, {
          credentials: "same-origin",
          cache: "no-store",
        });
      } catch {
        setFailure(toApiResult(0, null) as ApiFailure);
        return;
      }
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        const result = toApiResult(response.status, body);
        if (!result.ok) setFailure(result);
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = csvFileName(response.headers.get("content-disposition"));
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast({ tone: "success", title: "CSV descargado", description: "La exportación quedó registrada en la auditoría." });
      onClose();
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3">
      <p className="rounded-control border border-warning-border bg-warning-tint px-3 py-2 text-body-sm text-ink">
        Son datos personales: úsalo solo para la operación del evento y no lo compartas fuera del equipo. Queda registrado quién exporta, cuántas filas y por qué (no los datos).
      </p>
      <TextareaField
        id="export-reason"
        label="Motivo de la exportación"
        required
        value={reason}
        error={error ?? undefined}
        maxLength={500}
        onChange={(event) => {
          setReason(event.target.value);
          setError(null);
        }}
      />
      {failure ? <ErrorNoticeView view={describeFailure(failure)} onRetry={() => void submit()} /> : null}
      <ModalActions>
        <ModalClose asChild>
          <Button type="button" variant="secondary" disabled={pending}>
            Cancelar
          </Button>
        </ModalClose>
        <Button type="submit" loading={pending}>
          Descargar CSV
        </Button>
      </ModalActions>
    </form>
  );
}
