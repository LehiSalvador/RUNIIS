"use client";

import React from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SelectField, TextareaField } from "@/components/admin/events/fields";
import { apiFetch, newIdempotencyKey, type ApiFailure } from "@/lib/client/api";
import { describeFailure } from "@/components/admin/errors";
import {
  GUARDIAN_METHODS,
  buildGuardianReject,
  buildGuardianVerify,
  guardianIdentityLine,
  guardianRejectPath,
  guardianVerifyPath,
  type ParticipantMinimal,
} from "@/components/scanner/scan-api";

/**
 * Guardian verification dialog of T13 §3.6 / T12 J4 step 3, shown on top of the GUARDIAN_VERIFICATION_REQUIRED screen: the method
 * (select), optional notes, and two thumb-sized actions, Verificar and Rechazar. Both go to the existing API; nothing is shown as
 * decided until the server answers ok, a failure keeps the panel open with the actionable error and the same Idempotency-Key on retry.
 *
 * `onDecided("VERIFIED")` makes the scanner re-run the check-in on its own (the screen turns into the VALID outcome without a second
 * scan); `onDecided("REJECTED")` settles the screen on the blocked state.
 */
export function GuardianPanel({
  participant,
  onDecided,
  onCancel,
}: {
  participant: ParticipantMinimal;
  onDecided: (decision: "VERIFIED" | "REJECTED") => void;
  onCancel: () => void;
}) {
  const baseId = React.useId();
  const [method, setMethod] = React.useState<string>(GUARDIAN_METHODS[0]);
  const [notes, setNotes] = React.useState("");
  const [errors, setErrors] = React.useState<{ method?: string; notes?: string }>({});
  const [pending, setPending] = React.useState<"verify" | "reject" | null>(null);
  const [failure, setFailure] = React.useState<{ failure: ApiFailure; retry: () => void } | null>(null);
  // One key per intent: a retry of the same decision with the same content replays after a lost response, while changed content or
  // the other decision is a new intent with its own key (the server rejects a key reused with different content).
  const intents = React.useRef<{ verify: { key: string; signature: string }; reject: { key: string; signature: string } }>({
    verify: { key: newIdempotencyKey(), signature: "" },
    reject: { key: newIdempotencyKey(), signature: "" },
  });
  const titleRef = React.useRef<HTMLHeadingElement | null>(null);
  const busy = React.useRef(false);

  React.useEffect(() => {
    titleRef.current?.focus();
  }, []);

  async function decide(kind: "verify" | "reject") {
    if (busy.current) return;
    const registrationId = participant.registration_id;
    let path: string;
    let body: unknown;
    if (kind === "verify") {
      const decision = buildGuardianVerify({ method, notes });
      if (!decision.ok) {
        setErrors(decision.errors);
        return;
      }
      path = guardianVerifyPath(registrationId);
      body = decision.body;
    } else {
      const decision = buildGuardianReject(notes);
      if (!decision.ok) {
        setErrors({ notes: decision.error });
        return;
      }
      path = guardianRejectPath(registrationId);
      body = decision.body;
    }
    const signature = JSON.stringify(body);
    const intent = intents.current[kind];
    if (intent.signature !== "" && intent.signature !== signature) intent.key = newIdempotencyKey();
    intent.signature = signature;
    setErrors({});
    setFailure(null);
    busy.current = true;
    setPending(kind);
    try {
      const result = await apiFetch(path, { method: "POST", body, idempotencyKey: intent.key });
      if (result.ok) onDecided(kind === "verify" ? "VERIFIED" : "REJECTED");
      else setFailure({ failure: result, retry: () => void decide(kind) });
    } finally {
      busy.current = false;
      setPending(null);
    }
  }

  const view = failure ? describeFailure(failure.failure) : null;
  const identity = guardianIdentityLine(participant.guardian);

  return (
    <div role="group" aria-labelledby={`${baseId}-title`} className="flex flex-col gap-1" data-testid="guardian-panel">
      <h3 id={`${baseId}-title`} ref={titleRef} tabIndex={-1} className="text-h4 font-bold text-ink outline-none">
        Verificar al guardián
      </h3>
      <p className="text-body-sm text-ink-80">
        Pide una identificación al adulto que acompaña a {participant.display_name ?? "la persona menor"} y confirma en persona que es su
        guardián. Lo que registres queda como evidencia.
      </p>
      {identity ? (
        <div className="mt-2 rounded-control border border-divider bg-paper-sunken px-3 py-2" data-testid="guardian-identity">
          <p className="text-caption text-ink-80">Guardián registrado</p>
          <p className="text-body font-semibold text-ink">{identity}</p>
          <p className="text-caption text-ink-80">Compara este nombre con el de su identificación.</p>
        </div>
      ) : null}
      <div className="mt-2">
        <SelectField
          id={`${baseId}-method`}
          label="Cómo lo verificaste"
          required
          value={method}
          error={errors.method}
          options={GUARDIAN_METHODS.map((value) => ({ value, label: value }))}
          onChange={(event) => setMethod(event.target.value)}
        />
        <TextareaField
          id={`${baseId}-notes`}
          label="Notas (nombre del adulto, observaciones)"
          value={notes}
          error={errors.notes}
          maxLength={500}
          rows={2}
          helperText="Para rechazar, las notas son obligatorias: quedan como motivo."
          onChange={(event) => setNotes(event.target.value)}
        />
      </div>

      {view ? (
        <div role="alert" className="mb-2 rounded-control border border-danger-border bg-danger-tint px-3 py-2 text-body-sm text-ink" data-testid="guardian-error">
          <p className="font-semibold">{view.title}</p>
          <p>{view.message}</p>
          {view.requestId ? <p className="text-caption text-ink-80">Referencia de soporte: {view.requestId}</p> : null}
          {view.action === "retry" && failure ? (
            <Button size="md" variant="secondary" className="mt-2" onClick={failure.retry}>
              Reintentar
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <Button size="lg" variant="danger" onClick={() => void decide("reject")} loading={pending === "reject"} disabled={pending === "verify"} className="h-14">
          <X className="size-5" aria-hidden="true" />
          Rechazar
        </Button>
        <Button size="lg" onClick={() => void decide("verify")} loading={pending === "verify"} disabled={pending === "reject"} className="h-14">
          <Check className="size-5" aria-hidden="true" />
          Verificar
        </Button>
      </div>
      <Button variant="ghost" size="md" onClick={onCancel} disabled={pending !== null} className="mt-1 w-full">
        Decidir después
      </Button>
    </div>
  );
}
