"use client";

import React from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DrawerClose } from "@/components/ui/drawer";
import { TextField } from "@/components/ui/text-field";
import { FormField } from "@/components/ui/form-field";
import { CheckField, TextareaField } from "@/components/admin/events/fields";
import { apiFetch, type ApiFailure } from "@/lib/client/api";
import { describeFailure } from "@/components/admin/errors";
import {
  MIN_SEARCH_LENGTH,
  manualCheckInRequest,
  manualKitRequest,
  parseParticipantHits,
  searchUrl,
  type ParticipantHit,
  type ScanRequest,
} from "@/components/scanner/scan-api";
import type { ScanSession } from "@/components/scanner/session";

/**
 * Manual lookup (T12 J4 step 4): always one tap away inside the scan view, it feeds the SAME server checks as a scan. The search
 * (SEC-024: at least 3 characters, minimal fields) resolves a person by name, inscription number or the exact code printed on the pass (P-XXXX-XXXX, any letter case; a fragment of it does not match); the action that follows depends
 * on the session operation and is sent through the existing commands:
 *   check-in  -> POST /api/v1/check-in/manual-verify (reason required, one Idempotency-Key per intent)
 *   kit       -> POST /api/v1/admin/kits/pickup with registration_id (a third party needs a reason)
 * Rendered inside the shell's bottom Drawer, so the session bar stays visible above it.
 */
const GUARDIAN_LABEL: Record<NonNullable<ParticipantHit["guardian_state"]>, string> = {
  PENDING: "Menor: guardián por verificar",
  VERIFIED: "Menor: guardián verificado",
  REJECTED: "Menor: guardián rechazado",
};

export function ManualLookup({ session, onSubmit }: { session: ScanSession; onSubmit: (request: ScanRequest, rebuild: (key: string) => ScanRequest) => void }) {
  const baseId = React.useId();
  const [query, setQuery] = React.useState("");
  const [hint, setHint] = React.useState<string | null>(null);
  const [searching, setSearching] = React.useState(false);
  const [hits, setHits] = React.useState<ParticipantHit[] | null>(null);
  const [failure, setFailure] = React.useState<ApiFailure | null>(null);
  const [selected, setSelected] = React.useState<ParticipantHit | null>(null);
  const [reason, setReason] = React.useState("");
  const [thirdParty, setThirdParty] = React.useState(false);
  const busy = React.useRef(false);

  async function search(event?: React.FormEvent) {
    event?.preventDefault();
    if (busy.current) return;
    if (query.trim().length < MIN_SEARCH_LENGTH) {
      setHint(`Escribe al menos ${MIN_SEARCH_LENGTH} letras o números.`);
      return;
    }
    setHint(null);
    setFailure(null);
    setSelected(null);
    busy.current = true;
    setSearching(true);
    try {
      const result = await apiFetch<unknown>(searchUrl(session.editionId, query));
      if (result.ok) setHits(parseParticipantHits(result.data));
      else {
        setHits(null);
        setFailure(result);
      }
    } finally {
      busy.current = false;
      setSearching(false);
    }
  }

  const isKit = session.operation === "KIT_PICKUP";
  const reasonRequired = isKit ? thirdParty : true;
  const reasonOk = !reasonRequired || reason.trim().length > 0;
  const canAct = selected !== null && reasonOk && (isKit || selected.participant_pass_id !== null);

  function buildRequest(key: string): ScanRequest {
    const target = selected!;
    return isKit
      ? manualKitRequest(session, target.registration_id, thirdParty ? { reason } : null, key)
      : manualCheckInRequest(session, target.participant_pass_id!, reason, key);
  }

  const view = failure ? describeFailure(failure) : null;

  return (
    <div className="flex flex-col gap-4" data-testid="manual-lookup">
      <form onSubmit={search} className="flex flex-col gap-2" role="search" aria-label="Buscar participante">
        <FormField id={`${baseId}-q`} label="Nombre, inscripción o código del pase" errorText={hint ?? undefined} helperText="Mínimo 3 caracteres. El código del pase se escribe completo. Solo se muestran los datos necesarios.">
          <div className="flex gap-2">
            <TextField
              id={`${baseId}-q`}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              maxLength={200}
              autoComplete="off"
              enterKeyHint="search"
              invalid={Boolean(hint)}
              aria-describedby={hint ? `${baseId}-q-error` : `${baseId}-q-helper`}
            />
            <Button type="submit" size="md" loading={searching} className="shrink-0">
              <Search className="size-4" aria-hidden="true" />
              Buscar
            </Button>
          </div>
        </FormField>
      </form>

      {view ? (
        <div role="alert" className="rounded-control border border-danger-border bg-danger-tint px-3 py-2 text-body-sm text-ink" data-testid="lookup-error">
          <p className="font-semibold">{view.title}</p>
          <p>{view.message}</p>
          {view.retryAfterSeconds ? <p>Espera {view.retryAfterSeconds} segundos.</p> : null}
          {view.requestId ? <p className="text-caption text-ink-80">Referencia de soporte: {view.requestId}</p> : null}
        </div>
      ) : null}

      {hits !== null ? (
        hits.length === 0 ? (
          <p className="text-body-sm text-ink-80" role="status" data-testid="lookup-empty">
            No hay inscripciones confirmadas con ese dato en esta edición.
          </p>
        ) : (
          <ul className="flex flex-col gap-2" aria-label="Resultados">
            {hits.map((hit) => {
              const active = selected?.registration_id === hit.registration_id;
              return (
                <li key={hit.registration_id}>
                  <button
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      setSelected(hit);
                      setReason("");
                      setThirdParty(false);
                    }}
                    className={`flex min-h-16 w-full flex-col items-start justify-center rounded-card border px-4 py-2 text-left ${
                      active ? "border-ink bg-paper-sunken" : "border-control bg-paper-raised hover:border-ink-60"
                    }`}
                  >
                    <span className="text-body font-semibold text-ink">{hit.display_name ?? "Sin nombre"}</span>
                    <span className="text-body-sm text-ink-80">
                      Inscripción {hit.registration_number} · {hit.modality.name}
                    </span>
                    {hit.public_code ? <span className="text-caption text-ink-80">Pase {hit.public_code}</span> : null}
                    {hit.guardian_state ? <span className="text-caption font-semibold text-ink">{GUARDIAN_LABEL[hit.guardian_state]}</span> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )
      ) : null}

      {selected ? (
        <div className="flex flex-col gap-1 rounded-card border border-divider bg-paper-sunken p-4" data-testid="lookup-action">
          <p className="text-body font-semibold text-ink">{selected.display_name ?? "Participante"}</p>
          {!isKit && selected.participant_pass_id === null ? (
            <p role="status" className="text-body-sm text-ink-80">
              Esta inscripción no tiene un pase activo, así que no se puede registrar desde aquí. Envíala a la mesa de atención.
            </p>
          ) : null}
          {isKit ? (
            <CheckField
              id={`${baseId}-third`}
              label="Lo recoge otra persona"
              helperText="Anota quién lo recoge y por qué: queda registrado."
              checked={thirdParty}
              onChange={setThirdParty}
            />
          ) : null}
          {reasonRequired ? (
            <TextareaField
              id={`${baseId}-reason`}
              label={isKit ? "Quién recoge y por qué" : "Motivo del registro manual"}
              required
              value={reason}
              maxLength={500}
              rows={2}
              helperText={isKit ? undefined : "Por ejemplo: el teléfono no tiene batería. Queda como evidencia."}
              onChange={(event) => setReason(event.target.value)}
            />
          ) : null}
          <DrawerClose asChild>
            <Button size="lg" disabled={!canAct} onClick={() => onSubmit(buildRequest(crypto.randomUUID()), buildRequest)} className="h-14 w-full">
              {isKit ? "Entregar kit" : "Registrar llegada"}
            </Button>
          </DrawerClose>
        </div>
      ) : null}
    </div>
  );
}
