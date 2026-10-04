"use client";

import React from "react";
import { usePathname, useRouter } from "next/navigation";
import type { ApiResult } from "@/lib/client/api";
import { FormDialog } from "@/components/admin/events/form-dialog";
import { importGpx } from "@/components/admin/routes/route-api";
import { bytesToBase64, checkGpxFile, formatBytes, GPX_MAX_FILE_BYTES, gpxFailureReason } from "@/components/admin/routes/route-geometry";

/**
 * GPX import (Master §49). The browser refuses what the server would refuse for size BEFORE sending anything (the decoded cap of
 * 3.25 MB exists because the platform rejects any request body over 4.5 MB, and base64 inflates the file by a third); everything else (XML
 * hardening, tracks, coordinates, point count) is decided by the server and shown as its reason. An import always creates a DRAFT
 * revision: it never publishes and never touches the official distance.
 */
export function GpxImportDialog({ routeId, routeName, hasRevisions, onClose }: { routeId: string; routeName: string; hasRevisions: boolean; onClose: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [file, setFile] = React.useState<File | null>(null);
  const [problem, setProblem] = React.useState<string | null>(null);
  const [serverReason, setServerReason] = React.useState<string | null>(null);

  function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0] ?? null;
    setServerReason(null);
    if (!picked) {
      setFile(null);
      setProblem(null);
      return;
    }
    const check = checkGpxFile(picked);
    setFile(check.ok ? picked : null);
    setProblem(check.ok ? null : check.message);
  }

  async function onSubmit({ idempotencyKey }: { idempotencyKey: string }): Promise<ApiResult<unknown> | null> {
    if (!file) {
      setProblem(problem ?? "Elige un archivo .gpx.");
      inputRef.current?.focus();
      return null;
    }
    const check = checkGpxFile(file);
    if (!check.ok) {
      setProblem(check.message);
      return null;
    }
    setServerReason(null);
    let base64: string;
    try {
      base64 = bytesToBase64(new Uint8Array(await file.arrayBuffer()));
    } catch {
      setProblem("No se pudo leer el archivo. Vuelve a elegirlo.");
      return null;
    }
    const result = await importGpx(routeId, { source_filename: file.name.slice(0, 200), gpx_base64: base64 }, idempotencyKey);
    if (result.ok) router.push(`${pathname}?route=${routeId}&revision=${result.data.route_revision_id}`);
    else setServerReason(gpxFailureReason(result));
    return result;
  }

  const shown = problem ?? serverReason;
  return (
    <FormDialog
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Importar GPX"
      description={`Crea una revisión en borrador de «${routeName}» con el recorrido del archivo. ${hasRevisions ? "Las revisiones anteriores no cambian." : "Será la primera revisión de la ruta."}`}
      submitLabel="Importar GPX"
      successMessage="GPX importado como borrador"
      onSubmit={onSubmit}
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor="gpx-file" className="text-label font-semibold text-ink">
          Archivo GPX<span aria-hidden="true" className="text-danger"> *</span>
        </label>
        <input
          ref={inputRef}
          id="gpx-file"
          name="gpx"
          type="file"
          accept=".gpx,application/gpx+xml,application/xml,text/xml"
          aria-required="true"
          aria-invalid={shown ? true : undefined}
          aria-describedby={shown ? "gpx-file-error gpx-file-help" : "gpx-file-help"}
          onChange={onPick}
          className="block w-full rounded-control border border-control bg-paper-raised p-2 text-body-sm text-ink file:mr-3 file:rounded-control file:border file:border-control file:bg-paper-sunken file:px-3 file:py-1.5 file:font-semibold file:text-ink"
        />
        <p id="gpx-file-help" className="text-caption text-ink-60">
          Máximo {formatBytes(GPX_MAX_FILE_BYTES)}. Se toma el primer track (o ruta) del archivo y sus waypoints como puntos de interés. La distancia oficial de la
          modalidad no se modifica nunca.
        </p>
        {shown ? (
          <p id="gpx-file-error" role="alert" data-testid="gpx-problem" className="text-body-sm font-semibold text-danger">
            {shown}
          </p>
        ) : null}
        {file ? (
          <p className="text-caption text-ink-80" data-testid="gpx-file-chosen">
            {file.name} · {formatBytes(file.size)}
          </p>
        ) : null}
      </div>
    </FormDialog>
  );
}
