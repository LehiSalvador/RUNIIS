"use client";

import React from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Stepper, type StepperStep } from "@/components/ui/stepper";
import { toast } from "@/components/ui/use-toast";
import { apiFetch, newIdempotencyKey } from "@/lib/client/api";
import type { AccountLegalStatusResponse } from "@/lib/shared/legal";
import type { RegistrationContext } from "@/lib/shared/registration-context";
import { focusControl, participantScope } from "./bits";
import { fieldControlId } from "./dynamic-field";
import { blockedState } from "./logic/availability";
import { clearDraft, loadDraft, saveDraft } from "./logic/draft-storage";
import { bannerToShow, describeRefreshFailure, interpretCreateFailure, type BannerTone, type FailureAction } from "./logic/errors";
import {
  STEP_IDS,
  STEP_LABELS,
  NO_SERVER_ERRORS,
  bodySignature,
  buildCreateBody,
  ensureParticipant,
  initialDraft,
  legalStatus,
  mergeDetailsErrors,
  modalityOption,
  orderedSelection,
  participantsStepError,
  reconcileDraft,
  setAccepted,
  setCategory,
  setModality,
  setResponse,
  submitBlockedReason,
  toggleCandidate,
  validateDetails,
  type DetailsErrors,
  type Draft,
  type FieldValue,
  type ServerErrors,
  type StepId,
} from "./logic/model";
import { RequestOutcome, type OutcomeRequest } from "./request-outcome";
import { StepDetails } from "./step-details";
import { StepLegal } from "./step-legal";
import { StepParticipants } from "./step-participants";
import { StepReview } from "./step-review";
import { BlockedView, EditionHeader, ExistingRegistrations, SessionExpiredAlert } from "./status-views";

const STEPPER_STEPS: StepperStep[] = [...STEP_IDS.map((id) => ({ id, label: STEP_LABELS[id] })), { id: "result", label: "Resultado" }];

type Banner = { tone: BannerTone; title: string; body: string } | null;

function formatInEditionZone(timeZone: string) {
  return (iso: string): string => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    const options: Intl.DateTimeFormatOptions = { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false };
    try {
      return new Intl.DateTimeFormat("es-MX", { ...options, timeZone }).format(date);
    } catch {
      return new Intl.DateTimeFormat("es-MX", options).format(date);
    }
  };
}

function firstInvalidControl(ctx: RegistrationContext, draft: Draft, errors: DetailsErrors): string | null {
  for (const candidate of orderedSelection(ctx, draft)) {
    const entry = errors[candidate.candidate_key];
    if (!entry) continue;
    const scope = participantScope(candidate.candidate_key);
    if (entry.modality) {
      const participant = ensureParticipant(draft, candidate.candidate_key);
      const open = ctx.modalities.find((modality) => modalityOption(candidate, modality).selectable);
      return `${scope}-modality-${participant.modalityId ?? open?.modality_id ?? ctx.modalities[0]?.modality_id}`;
    }
    if (entry.category) return `${scope}-category`;
    const field = Object.keys(entry.fields)[0];
    if (field) return fieldControlId(scope, field);
  }
  return null;
}

export function RegistrationFlow({ initialContext, slug }: { initialContext: RegistrationContext; slug: string }) {
  const [ctx, setCtx] = React.useState(initialContext);
  const [draft, setDraft] = React.useState<Draft>(() => initialDraft(initialContext));
  const [step, setStep] = React.useState<StepId>("participants");
  const [attempted, setAttempted] = React.useState<ReadonlySet<StepId>>(new Set());
  const [stepError, setStepError] = React.useState<string | null>(null);
  const [serverErrors, setServerErrors] = React.useState<ServerErrors>(NO_SERVER_ERRORS);
  const [banner, setBanner] = React.useState<Banner>(null);
  const [sessionExpired, setSessionExpired] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [refreshing, setRefreshing] = React.useState(false);
  const [retryAt, setRetryAt] = React.useState<string | null>(null);
  const [outcome, setOutcome] = React.useState<OutcomeRequest | null>(null);
  const [hydrated, setHydrated] = React.useState(false);

  const headingRef = React.useRef<HTMLHeadingElement>(null);
  const submittingRef = React.useRef(false);
  const idempotency = React.useRef<{ key: string; signature: string } | null>(null);
  const focusAfterRender = React.useRef<string | "heading" | null>(null);
  const editionId = ctx.edition.edition_id;

  // Restore what this tab already typed (session expired / reload), then keep it saved. Storage may be absent.
  React.useEffect(() => {
    // After hydration, from a timer callback: sessionStorage is an external system the server render cannot see.
    const timer = window.setTimeout(() => {
      const saved = loadDraft(initialContext.edition.edition_id);
      if (saved && saved.selected.length > 0) setDraft(reconcileDraft(initialContext, saved));
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [initialContext]);
  React.useEffect(() => {
    if (hydrated && !outcome) saveDraft(editionId, draft);
  }, [draft, editionId, hydrated, outcome]);

  React.useEffect(() => {
    const target = focusAfterRender.current;
    if (!target) return;
    focusAfterRender.current = null;
    if (target === "heading") headingRef.current?.focus();
    else if (!focusControl(target)) headingRef.current?.focus();
  });

  const refreshContext = React.useCallback(
    async (options: { silent?: boolean } = {}): Promise<RegistrationContext | null> => {
      if (!options.silent) setRefreshing(true);
      const result = await apiFetch<RegistrationContext>(`/api/v1/events/${encodeURIComponent(slug)}/registration-context`);
      if (!options.silent) setRefreshing(false);
      if (!result.ok) {
        const info = describeRefreshFailure(result);
        if (info.sessionExpired) setSessionExpired(true);
        else if (info.accountBlocked) window.location.reload();
        else if (!options.silent) setBanner({ tone: "danger", title: "No pudimos actualizar la información", body: info.message });
        return null;
      }
      setCtx(result.data);
      setDraft((current) => reconcileDraft(result.data, current));
      return result.data;
    },
    [slug],
  );

  function goTo(next: StepId) {
    setStep(next);
    setStepError(null);
    focusAfterRender.current = "heading";
    window.scrollTo({ top: 0 });
    if (next === "review") void refreshContext({ silent: true });
  }

  function clearServerRow(key: string) {
    setServerErrors((current) => (current.rows[key] ? { ...current, rows: { ...current.rows, [key]: [] } } : current));
  }

  // ---- Draft handlers (every change clears the server verdict it may have answered) ----
  function onToggle(key: string, on: boolean) {
    setDraft((current) => toggleCandidate(ctx, current, key, on));
    clearServerRow(key);
    setStepError(null);
  }
  function onModality(key: string, modalityId: string) {
    setDraft((current) => setModality(ctx, current, key, modalityId));
    setServerErrors((current) => ({ rows: { ...current.rows, [key]: [] }, fields: { ...current.fields, [key]: {} }, categories: { ...current.categories, [key]: "" } }));
  }
  function onCategory(key: string, categoryId: string) {
    setDraft((current) => setCategory(current, key, categoryId));
    setServerErrors((current) => ({ ...current, categories: { ...current.categories, [key]: "" } }));
  }
  function onResponse(key: string, fieldKey: string, value: FieldValue | undefined) {
    setDraft((current) => setResponse(current, key, fieldKey, value));
    setServerErrors((current) => ({ ...current, fields: { ...current.fields, [key]: { ...current.fields[key], [fieldKey]: "" } } }));
  }
  function onAccepted(key: string, versionId: string, accepted: boolean) {
    setDraft((current) => setAccepted(current, key, versionId, accepted));
    clearServerRow(key);
    setStepError(null);
  }

  async function acceptAccount(versionIds: string[]) {
    const result = await apiFetch<AccountLegalStatusResponse>("/api/v1/me/legal/accept", { method: "POST", body: { legal_document_version_ids: versionIds } });
    if (!result.ok) {
      if (result.code === "AUTH_REQUIRED") setSessionExpired(true);
      else if (result.code === "LEGAL_ACCEPTANCE_REQUIRED") void refreshContext({ silent: true });
      return result;
    }
    const { server_time: _serverTime, ...legal } = result.data;
    void _serverTime;
    setCtx((current) => ({ ...current, account_legal: legal }));
    setStepError(null);
    setBanner(null);
    focusAfterRender.current = "heading";
    toast({ tone: "success", title: "Aceptaste los documentos de tu cuenta" });
    return null;
  }

  // ---- Step navigation with validation (the server revalidates everything again on submit) ----
  function markAttempted(id: StepId) {
    setAttempted((current) => new Set(current).add(id));
  }

  function next() {
    setBanner(null);
    if (step === "participants") {
      const error = participantsStepError(ctx, draft);
      if (error) {
        setStepError(error);
        return;
      }
      goTo("details");
      return;
    }
    if (step === "details") {
      markAttempted("details");
      const errors = mergeDetailsErrors(validateDetails(ctx, draft), serverErrors);
      if (Object.keys(errors).length > 0) {
        setStepError("Revisa los datos marcados.");
        focusAfterRender.current = firstInvalidControl(ctx, draft, errors);
        return;
      }
      goTo("legal");
      return;
    }
    if (step === "legal") {
      const status = legalStatus(ctx, draft);
      if (!status.complete) {
        setStepError(
          status.accountPending
            ? "Acepta los documentos de tu cuenta para continuar."
            : status.buyerBoxesPending > 0
              ? "Marca los documentos pendientes para continuar."
              : "Hay personas que deben aceptar sus documentos desde su cuenta antes de que puedas enviar.",
        );
        return;
      }
      goTo("review");
    }
  }

  function back() {
    const index = STEP_IDS.indexOf(step);
    if (index > 0) goTo(STEP_IDS[index - 1]);
  }

  function applyFailure(action: FailureAction) {
    setBanner(bannerToShow(action));
    setServerErrors({ rows: action.rowErrors, fields: action.fieldErrors, categories: action.categoryErrors });
    if (action.sessionExpired) setSessionExpired(true);
    if (action.accountBlocked) {
      window.location.reload();
      return;
    }
    if (action.retryAfterSeconds) setRetryAt(new Date(Date.now() + action.retryAfterSeconds * 1000).toISOString());
    if (!action.keepIdempotencyKey) idempotency.current = null;
    if (action.goToStep) {
      setStep(action.goToStep);
      focusAfterRender.current = "heading";
      window.scrollTo({ top: 0 });
    }
    if (action.refreshContext) void refreshContext({ silent: true });
  }

  async function submit() {
    if (submittingRef.current) return;
    const blocked = submitBlockedReason(ctx, draft);
    if (blocked) {
      setBanner({ tone: "warning", title: "Todavía no puedes enviar", body: blocked });
      return;
    }
    const body = buildCreateBody(ctx, draft);
    const signature = bodySignature(body);
    // One key per submit attempt: reused when the same payload is retried (transport failure), new when it changed.
    if (!idempotency.current || idempotency.current.signature !== signature) idempotency.current = { key: newIdempotencyKey(), signature };
    const order = orderedSelection(ctx, draft);
    submittingRef.current = true;
    setSubmitting(true);
    setBanner(null);
    const result = await apiFetch<OutcomeRequest>("/api/v1/registration-requests", { method: "POST", body, idempotencyKey: idempotency.current.key });
    submittingRef.current = false;
    setSubmitting(false);
    if (result.ok) {
      clearDraft(editionId);
      idempotency.current = null;
      setServerErrors(NO_SERVER_ERRORS);
      setOutcome(result.data);
      focusAfterRender.current = "heading";
      window.scrollTo({ top: 0 });
      return;
    }
    applyFailure(interpretCreateFailure(result, order));
  }

  async function restart() {
    const fresh = await refreshContext();
    if (!fresh) return;
    setOutcome(null);
    setDraft(initialDraft(fresh));
    setStep("participants");
    setAttempted(new Set());
    setBanner(null);
    focusAfterRender.current = "heading";
  }

  // ---- Which screen ----
  const pendingExisting = ctx.existing.pending_request;
  const shownRequest = outcome ?? pendingExisting;
  const blocked = blockedState(ctx, formatInEditionZone(ctx.edition.timezone));
  const detailsErrors = attempted.has("details") ? mergeDetailsErrors(validateDetails(ctx, draft), serverErrors) : mergeDetailsErrors({}, serverErrors);
  const currentIndex = STEP_IDS.indexOf(step);
  const reviewBlocked = step === "review" ? submitBlockedReason(ctx, draft) : null;

  if (shownRequest) {
    return (
      <div className="flex flex-col gap-8">
        <EditionHeader ctx={ctx} />
        {sessionExpired ? <SessionExpiredAlert slug={slug} /> : null}
        <RequestOutcome
          key={shownRequest.registration_request_id}
          request={shownRequest}
          alreadyExisting={!outcome}
          headingRef={headingRef}
          onCanceled={(canceled) => {
            setOutcome(canceled);
            void refreshContext({ silent: true });
          }}
          onRestart={() => void restart()}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <EditionHeader ctx={ctx} />
      <ExistingRegistrations registrations={ctx.existing.registrations} />
      {sessionExpired ? <SessionExpiredAlert slug={slug} /> : null}

      {blocked ? (
        <BlockedView state={blocked} onRefresh={() => void refreshContext()} refreshing={refreshing} edition={ctx.edition} />
      ) : (
        <>
          <Stepper
            steps={STEPPER_STEPS}
            currentStepId={step}
            aria-label="Pasos de la inscripción"
            onStepSelect={(id) => goTo(id as StepId)}
            isStepSelectable={(id, index, current) => index < current && id !== "result"}
          />

          {banner ? (
            <Alert tone={banner.tone} title={banner.title}>
              {banner.body}
            </Alert>
          ) : null}

          <div className="rounded-panel border border-divider bg-paper-sunken/40 p-4 sm:p-6" data-testid="registration-step" data-step={step}>
            {step === "participants" ? (
              <StepParticipants ctx={ctx} draft={draft} rowErrors={serverErrors.rows} headingRef={headingRef} onToggle={onToggle} onRefresh={() => void refreshContext()} refreshing={refreshing} />
            ) : null}
            {step === "details" ? (
              <StepDetails ctx={ctx} draft={draft} errors={detailsErrors} rowErrors={serverErrors.rows} headingRef={headingRef} onModality={onModality} onCategory={onCategory} onResponse={onResponse} />
            ) : null}
            {step === "legal" ? (
              <StepLegal ctx={ctx} draft={draft} rowErrors={serverErrors.rows} headingRef={headingRef} onAcceptAccount={acceptAccount} onAccepted={onAccepted} onRefresh={() => void refreshContext()} refreshing={refreshing} />
            ) : null}
            {step === "review" ? (
              <StepReview
                ctx={ctx}
                draft={draft}
                headingRef={headingRef}
                submitting={submitting}
                retryAt={retryAt}
                onRetryReady={() => setRetryAt(null)}
                blockedReason={reviewBlocked}
                onEdit={goTo}
                onSubmit={() => void submit()}
              />
            ) : null}

            {stepError ? (
              <p role="alert" className="mt-5 text-body-sm font-semibold text-danger" data-testid="step-error">
                {stepError}
              </p>
            ) : null}

            {step !== "review" ? (
              <div className="mt-6 flex flex-col-reverse gap-3 border-t border-divider pt-5 sm:flex-row sm:justify-between">
                {currentIndex > 0 ? (
                  <Button variant="secondary" size="lg" onClick={back}>
                    <ArrowLeft className="size-4" aria-hidden="true" />
                    Atrás
                  </Button>
                ) : (
                  <span />
                )}
                <Button size="lg" onClick={next} className="sm:min-w-48">
                  Continuar
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Button>
              </div>
            ) : (
              <div className="mt-6 border-t border-divider pt-5">
                <Button variant="secondary" size="lg" onClick={back}>
                  <ArrowLeft className="size-4" aria-hidden="true" />
                  Atrás
                </Button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
