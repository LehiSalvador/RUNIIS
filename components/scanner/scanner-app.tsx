"use client";

import React from "react";
import Link from "next/link";
import { Keyboard, LogOut, ScanLine, WifiOff } from "lucide-react";
import { ScannerShell } from "@/components/shell/scanner-shell";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { FormField } from "@/components/ui/form-field";
import { apiFetch } from "@/lib/client/api";
import { GuardianPanel } from "@/components/scanner/guardian-panel";
import { ManualLookup } from "@/components/scanner/manual-lookup";
import { OPERATION_LABEL, type ScanOperation } from "@/components/scanner/outcomes";
import { QrCamera } from "@/components/scanner/qr-camera";
import { ScannerFeedback, type FeedbackView } from "@/components/scanner/scanner-feedback";
import {
  describeScanFailure,
  listItems,
  scanRequest,
  sendScan,
  withFreshKey,
  type ParticipantMinimal,
  type ScanRequest,
} from "@/components/scanner/scan-api";
import {
  hasErrors,
  readStoredDraft,
  selectableKits,
  sessionStorageOrNull,
  storeDraft,
  validateSessionDraft,
  type KitChoice,
  type ScanSession,
  type SessionDraft,
  type SessionErrors,
} from "@/components/scanner/session";

export type ScannerEdition = { id: string; name: string; detail: string | null };

/**
 * /scanner (T13 §4.15, T12 J4): one full-viewport screen for CHECKIN staff on a phone. Session first (Edition + station + operation,
 * required before the camera opens), then scan (camera, or a typed/pasted code for external readers), with the manual lookup one
 * tap away in the top bar. Every answer comes from the server and replaces the whole viewport with ScannerFeedback.
 *
 * What this component never does: judge a credential, parse a QR, keep a code after it was sent, log a code, or show a success
 * before the server answered. Check-in is evidence of arrival, so no copy here talks about attendance.
 */
const subscribeNothing = () => () => undefined;

function subscribeOnline(listener: () => void) {
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
}

type Feedback = {
  view: FeedbackView;
  /** The request that produced it, kept so "Reintentar" re-sends the very same call (same Idempotency-Key). */
  request: ScanRequest | null;
  /** Builds a NEW request for the same target with a given key (a new intent after the guardian was verified). */
  rebuild: ((key: string) => ScanRequest) | null;
};

export function ScannerApp({ editions }: { editions: readonly ScannerEdition[] }) {
  const hydrated = React.useSyncExternalStore(subscribeNothing, () => true, () => false);
  const [session, setSession] = React.useState<ScanSession | null>(null);

  if (!hydrated) {
    return (
      <ScannerShell sessionContext={<p className="font-semibold">Preparando el escáner…</p>}>
        <p className="p-6 text-body text-paper" role="status">
          Cargando…
        </p>
      </ScannerShell>
    );
  }
  if (!session) return <SessionSetup editions={editions} onStart={setSession} />;
  return <ScanScreen key={`${session.editionId}|${session.station}|${session.operation}|${session.kitDefinitionId}`} session={session} onEnd={() => setSession(null)} />;
}

// ---- Session setup ---------------------------------------------------------------------------------------------------------------

function SessionSetup({ editions, onStart }: { editions: readonly ScannerEdition[]; onStart: (session: ScanSession) => void }) {
  const baseId = React.useId();
  const [draft, setDraft] = React.useState<SessionDraft>(() => {
    const stored = readStoredDraft(sessionStorageOrNull());
    const editionId = stored.editionId && editions.some((edition) => edition.id === stored.editionId) ? stored.editionId : (editions.length === 1 ? editions[0].id : "");
    return { editionId, station: stored.station ?? "", operation: stored.operation ?? "", kitDefinitionId: stored.kitDefinitionId ?? "" };
  });
  const [errors, setErrors] = React.useState<SessionErrors>({});
  const [kits, setKits] = React.useState<{ editionId: string; items: KitChoice[] } | { editionId: string; failed: true } | null>(null);

  const needsKits = draft.operation === "KIT_PICKUP" && draft.editionId !== "";
  React.useEffect(() => {
    if (!needsKits) return;
    let alive = true;
    void apiFetch<unknown>(`/api/v1/admin/kits/inventory?edition_id=${encodeURIComponent(draft.editionId)}`).then((result) => {
      if (!alive) return;
      setKits(result.ok ? { editionId: draft.editionId, items: selectableKits(listItems(result.data) as KitChoice[]) } : { editionId: draft.editionId, failed: true });
    });
    return () => {
      alive = false;
    };
  }, [needsKits, draft.editionId]);

  const kitState = kits && kits.editionId === draft.editionId ? kits : null;
  const kitItems = kitState && "items" in kitState ? kitState.items : [];
  // With exactly one kit there is nothing to choose: take it.
  const effectiveKit = draft.kitDefinitionId || (kitItems.length === 1 ? kitItems[0].kit_definition_id : "");

  function set<K extends keyof SessionDraft>(key: K, value: SessionDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setErrors((current) => (current[key] ? { ...current, [key]: undefined } : current));
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const next = { ...draft, kitDefinitionId: effectiveKit };
    const found = validateSessionDraft(next, editions.map((edition) => edition.id));
    setErrors(found);
    if (hasErrors(found) || next.operation === "") return;
    storeDraft(sessionStorageOrNull(), next);
    const edition = editions.find((item) => item.id === next.editionId)!;
    const kit = kitItems.find((item) => item.kit_definition_id === next.kitDefinitionId) ?? null;
    onStart({
      editionId: edition.id,
      editionName: edition.name,
      station: next.station.trim(),
      operation: next.operation,
      kitDefinitionId: next.operation === "KIT_PICKUP" ? next.kitDefinitionId : null,
      kitName: next.operation === "KIT_PICKUP" ? (kit?.name ?? null) : null,
    });
  }

  return (
    <ScannerShell sessionContext={<p className="font-semibold">Nueva sesión</p>}>
      <div className="flex h-full justify-center overflow-y-auto p-4">
        <form onSubmit={submit} noValidate className="my-auto flex w-full max-w-md flex-col gap-1 rounded-card bg-paper-raised p-5 text-ink" data-testid="session-setup">
          <h2 className="text-h4 font-bold">Antes de escanear</h2>
          <p className="mb-2 text-body-sm text-ink-80">Elige la edición, tu estación y qué vas a hacer. No se puede escanear hasta completarlo.</p>

          {editions.length === 0 ? (
            <p role="alert" className="rounded-control border border-warning-border bg-warning-tint px-3 py-2 text-body-sm text-ink" data-testid="no-editions">
              No hay ediciones disponibles para tu acceso. Pide a un administrador que revise tu asignación.
            </p>
          ) : null}

          <FormField id={`${baseId}-edition`} label="Edición" required errorText={errors.editionId}>
            <select
              id={`${baseId}-edition`}
              value={draft.editionId}
              onChange={(event) => set("editionId", event.target.value)}
              aria-invalid={errors.editionId ? true : undefined}
              aria-describedby={errors.editionId ? `${baseId}-edition-error` : undefined}
              className="h-12 w-full rounded-control border border-control bg-paper-raised px-3 text-body text-ink"
            >
              <option value="">Elige una edición</option>
              {editions.map((edition) => (
                <option key={edition.id} value={edition.id}>
                  {edition.name}
                  {edition.detail ? ` · ${edition.detail}` : ""}
                </option>
              ))}
            </select>
          </FormField>

          <FormField id={`${baseId}-station`} label="Estación" required errorText={errors.station} helperText="Cómo se llama tu puesto, por ejemplo «Entrada 1». Queda en cada registro.">
            <TextField
              id={`${baseId}-station`}
              value={draft.station}
              maxLength={100}
              autoComplete="off"
              invalid={Boolean(errors.station)}
              aria-describedby={errors.station ? `${baseId}-station-error` : `${baseId}-station-helper`}
              onChange={(event) => set("station", event.target.value)}
              className="h-12"
            />
          </FormField>

          <fieldset className="flex flex-col gap-1.5" aria-describedby={errors.operation ? `${baseId}-operation-error` : undefined}>
            <legend className="mb-1.5 text-label font-semibold text-ink">
              Operación<span aria-hidden="true" className="text-danger"> *</span>
            </legend>
            {(["EVENT_CHECKIN", "KIT_PICKUP"] as ScanOperation[]).map((operation) => (
              <label
                key={operation}
                className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-control border px-4 text-body ${draft.operation === operation ? "border-ink bg-paper-sunken font-semibold" : "border-control"}`}
              >
                <input
                  type="radio"
                  name={`${baseId}-operation`}
                  value={operation}
                  checked={draft.operation === operation}
                  onChange={() => set("operation", operation)}
                  className="size-5 accent-[var(--color-ink)]"
                />
                {OPERATION_LABEL[operation]}
              </label>
            ))}
            <div className="min-h-[1.25rem] text-caption">
              {errors.operation ? (
                <p id={`${baseId}-operation-error`} role="alert" className="text-danger">
                  {errors.operation}
                </p>
              ) : null}
            </div>
          </fieldset>

          {draft.operation === "KIT_PICKUP" ? (
            <FormField id={`${baseId}-kit`} label="Kit que entregas" required errorText={errors.kitDefinitionId}>
              {kitState && "failed" in kitState ? (
                <p role="alert" className="text-body-sm text-danger">
                  No pudimos cargar los kits de la edición. Cambia de edición o vuelve a intentarlo en un momento.
                </p>
              ) : kitState && kitItems.length === 0 ? (
                <p role="status" className="text-body-sm text-ink-80">
                  Esta edición no tiene kits activos para entregar.
                </p>
              ) : (
                <select
                  id={`${baseId}-kit`}
                  value={effectiveKit}
                  disabled={!kitState}
                  onChange={(event) => set("kitDefinitionId", event.target.value)}
                  aria-invalid={errors.kitDefinitionId ? true : undefined}
                  className="h-12 w-full rounded-control border border-control bg-paper-raised px-3 text-body text-ink disabled:bg-paper-sunken"
                >
                  <option value="">{kitState ? "Elige un kit" : "Cargando kits…"}</option>
                  {kitItems.map((kit) => (
                    <option key={kit.kit_definition_id} value={kit.kit_definition_id}>
                      {kit.name}
                    </option>
                  ))}
                </select>
              )}
            </FormField>
          ) : null}

          <Button type="submit" size="lg" className="mt-2 h-14 w-full" disabled={editions.length === 0}>
            <ScanLine className="size-5" aria-hidden="true" />
            Empezar a escanear
          </Button>
          <Link href="/admin" prefetch={false} className="mt-2 inline-flex min-h-11 items-center justify-center text-body-sm font-semibold text-ink underline underline-offset-4">
            Volver al panel
          </Link>
        </form>
      </div>
    </ScannerShell>
  );
}

// ---- Scan screen -----------------------------------------------------------------------------------------------------------------

function ScanScreen({ session, onEnd }: { session: ScanSession; onEnd: () => void }) {
  const codeId = React.useId();
  const online = React.useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const [feedback, setFeedback] = React.useState<Feedback | null>(null);
  const [sending, setSending] = React.useState(false);
  const [code, setCode] = React.useState("");
  const [codeHint, setCodeHint] = React.useState<string | null>(null);
  const busy = React.useRef(false);
  const areaRef = React.useRef<HTMLDivElement | null>(null);

  const run = React.useCallback(
    async (request: ScanRequest, rebuild: ((key: string) => ScanRequest) | null) => {
      if (busy.current) return;
      busy.current = true;
      setSending(true);
      try {
        const attempt = await sendScan(request);
        if (attempt.kind === "outcome") setFeedback({ view: { kind: "outcome", result: attempt.result, operation: session.operation }, request, rebuild });
        else setFeedback({ view: { kind: "failure", error: describeScanFailure(attempt.failure), retryable: attempt.retryable }, request, rebuild });
      } finally {
        busy.current = false;
        setSending(false);
      }
    },
    [session.operation],
  );

  const scanCode = React.useCallback(
    (raw: string) => {
      const value = raw.trim();
      if (value.length === 0) return;
      void run(scanRequest(session, session.operation, value), null);
    },
    [run, session],
  );

  function dismiss() {
    setFeedback(null);
    areaRef.current?.focus();
  }

  function submitCode(event: React.FormEvent) {
    event.preventDefault();
    if (code.trim().length === 0) {
      setCodeHint("Escribe o pega el código del pase.");
      return;
    }
    setCodeHint(null);
    const value = code;
    // The code is dropped from the field the moment it is sent: it is a credential, not something to leave on screen.
    setCode("");
    scanCode(value);
  }

  function retry() {
    if (feedback?.request) void run(feedback.request, feedback.rebuild);
  }

  function afterGuardianVerified() {
    if (!feedback?.request) return dismiss();
    // New intent: the previous key would replay the stored "guardian required" answer.
    const next = feedback.rebuild ? feedback.rebuild(crypto.randomUUID()) : withFreshKey(feedback.request);
    setFeedback(null);
    void run(next, feedback.rebuild);
  }

  function afterGuardianRejected(participant: ParticipantMinimal | null) {
    setFeedback({ view: { kind: "guardian_blocked", participant }, request: null, rebuild: null });
  }

  const panel =
    feedback?.view.kind === "outcome" && feedback.view.result.outcome === "GUARDIAN_VERIFICATION_REQUIRED" && feedback.view.result.participant ? (
      <GuardianPanel
        participant={feedback.view.result.participant}
        onDecided={(decision) => (decision === "VERIFIED" ? afterGuardianVerified() : afterGuardianRejected(feedback.view.kind === "outcome" ? feedback.view.result.participant : null))}
        onCancel={dismiss}
      />
    ) : undefined;

  const operationText = session.kitName ? `${OPERATION_LABEL[session.operation]} · ${session.kitName}` : OPERATION_LABEL[session.operation];

  return (
    <ScannerShell
      sessionContext={
        <div className="flex items-center gap-3 py-1" data-testid="session-context">
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{session.editionName}</p>
            <p className="truncate text-caption text-paper/80">
              {session.station} · {operationText}
            </p>
          </div>
          <button type="button" onClick={onEnd} className="inline-flex min-h-11 shrink-0 items-center rounded-control px-2 text-body-sm font-semibold text-paper underline underline-offset-4">
            Cambiar
          </button>
          <Link href="/admin" prefetch={false} aria-label="Salir del escáner" className="inline-flex size-11 shrink-0 items-center justify-center rounded-control text-paper">
            <LogOut className="size-5" aria-hidden="true" />
          </Link>
        </div>
      }
      manualLookup={<ManualLookup session={session} onSubmit={(request, rebuild) => void run(request, rebuild)} />}
      feedback={
        feedback ? (
          <ScannerFeedback
            view={feedback.view}
            onDismiss={dismiss}
            onRetry={feedback.view.kind === "failure" && feedback.view.retryable && feedback.request ? retry : undefined}
            panel={panel}
          />
        ) : null
      }
    >
      <div ref={areaRef} tabIndex={-1} inert={feedback !== null} className="flex h-full flex-col gap-4 overflow-y-auto p-4 outline-none" data-testid="scan-area">
        {!online ? (
          <div role="alert" className="flex items-center gap-3 rounded-card border border-danger-border bg-danger-tint px-4 py-3 text-body-sm text-ink" data-testid="offline-banner">
            <WifiOff className="size-6 shrink-0 text-danger" aria-hidden="true" />
            <p>
              <span className="font-semibold">Sin conexión.</span> No se acepta ningún código hasta que vuelva la conexión.
            </p>
          </div>
        ) : null}

        <QrCamera paused={sending || feedback !== null || !online} onCode={scanCode} />

        <form onSubmit={submitCode} className="flex flex-col gap-1 rounded-card bg-paper-raised p-4 text-ink" aria-label="Código escrito">
          <FormField id={codeId} label="Código del pase" errorText={codeHint ?? undefined} helperText="Con un lector externo, apunta aquí; o pega el código.">
            <div className="flex gap-2">
              <TextField
                id={codeId}
                value={code}
                onChange={(event) => setCode(event.target.value)}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                inputMode="text"
                invalid={Boolean(codeHint)}
                aria-describedby={codeHint ? `${codeId}-error` : `${codeId}-helper`}
                className="h-12"
                leadingIcon={<Keyboard className="size-5" aria-hidden="true" />}
              />
              <Button type="submit" size="lg" loading={sending} disabled={!online} className="h-12 shrink-0">
                Enviar
              </Button>
            </div>
          </FormField>
        </form>

        {sending ? (
          <p role="status" className="text-center text-body text-paper" data-testid="scan-sending">
            Verificando con el servidor…
          </p>
        ) : null}
      </div>
    </ScannerShell>
  );
}
