"use client";

import React from "react";
import { Alert } from "@/components/ui/alert";
import { FormField } from "@/components/ui/form-field";
import { RadioGroup, RadioItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/client/cn";
import { formatMoney } from "@/lib/client/account-format";
import type { RegistrationCandidate, RegistrationContext, RegistrationContextModality } from "@/lib/shared/registration-context";
import { candidateName, participantScope, RelationBadge, StepHeading } from "./bits";
import { DynamicField, fieldControlId } from "./dynamic-field";
import {
  categoryChoices,
  categoryRequired,
  derivedCategoryName,
  ensureParticipant,
  fieldsFor,
  modalityOf,
  modalityOption,
  orderedSelection,
  type DetailsErrors,
  type Draft,
  type FieldValue,
} from "./logic/model";

function distanceLabel(meters: number | null): string | null {
  if (meters === null) return null;
  return meters % 1000 === 0 ? `${meters / 1000} km` : `${(meters / 1000).toFixed(1).replace(/\.0$/, "")} km`;
}

function timeLabel(value: string | null): string | null {
  return value ? value.slice(0, 5) : null;
}

function AvailabilityChip({ modality }: { modality: RegistrationContextModality }) {
  if (modality.status === "CLOSED") return <StatusBadge state="CLOSED" label="Modalidad cerrada" />;
  if (modality.availability_state === "AVAILABLE") return null;
  return <StatusBadge state={modality.availability_state} />;
}

function ModalityOption({
  candidate,
  modality,
  groupId,
}: {
  candidate: RegistrationCandidate;
  modality: RegistrationContextModality;
  groupId: string;
}) {
  const state = modalityOption(candidate, modality);
  const optionId = `${groupId}-${modality.modality_id}`;
  const reasonId = `${optionId}-reason`;
  const meta = [distanceLabel(modality.official_distance_m), timeLabel(modality.local_start_time) ? `Salida ${timeLabel(modality.local_start_time)}` : null].filter(Boolean);
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-card border bg-paper-raised pr-4 transition-colors duration-fast ease-standard has-[[data-state=checked]]:border-ink has-[[data-state=checked]]:bg-lime-soft",
        state.selectable ? "border-divider hover:border-ink-60" : "border-divider bg-paper-sunken/60",
      )}
    >
      <RadioItem id={optionId} value={modality.modality_id} disabled={!state.selectable} aria-describedby={state.reason ? reasonId : undefined} className="mt-0.5 shrink-0" />
      <label htmlFor={optionId} className={cn("flex min-w-0 flex-1 flex-col gap-1 py-3", state.selectable ? "cursor-pointer" : "cursor-not-allowed")}>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className={cn("text-body font-semibold", state.selectable ? "text-ink" : "text-ink-60")}>{modality.name}</span>
          <AvailabilityChip modality={modality} />
        </span>
        <span className="text-body-sm text-ink-60">
          {meta.join(" · ")}
          {meta.length > 0 && modality.price ? " · " : ""}
          {modality.price ? <span className="font-semibold text-ink tabular-nums">{formatMoney(modality.price.amount_minor, modality.price.currency)}</span> : null}
        </span>
        {state.reason ? (
          <span id={reasonId} className="text-body-sm text-ink-80">
            {state.reason}
          </span>
        ) : null}
      </label>
    </div>
  );
}

/**
 * ui-spec RegistrationParticipantCard: per participant, modality (only the ones the server says are open for
 * that person, the rest disabled with the reason), category (select when the buyer chooses, read-only when
 * the system derives it) and the server's form definition.
 */
function ParticipantDetailsCard({
  ctx,
  candidate,
  draft,
  errors,
  rowErrors,
  onModality,
  onCategory,
  onResponse,
}: {
  ctx: RegistrationContext;
  candidate: RegistrationCandidate;
  draft: Draft;
  errors: DetailsErrors[string] | undefined;
  rowErrors: string[];
  onModality: (candidateKey: string, modalityId: string) => void;
  onCategory: (candidateKey: string, categoryId: string) => void;
  onResponse: (candidateKey: string, fieldKey: string, value: FieldValue | undefined) => void;
}) {
  const key = candidate.candidate_key;
  const scope = participantScope(key);
  const participant = ensureParticipant(draft, key);
  const modality = modalityOf(ctx, participant.modalityId);
  const groupId = `${scope}-modality`;
  const fields = modality ? fieldsFor(ctx, modality.modality_id) : [];
  const needsCategory = categoryRequired(candidate, modality);
  const choices = modality && needsCategory ? categoryChoices(ctx, candidate, modality.modality_id) : [];
  const derived = modality && modality.category_mode === "SYSTEM_DERIVES" ? derivedCategoryName(ctx, candidate, modality.modality_id) : null;
  const categoryId = `${scope}-category`;
  const selectedCategory = choices.find((choice) => choice.category_id === participant.categoryId);
  const headingId = `${scope}-heading`;

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-5 rounded-card border border-divider bg-paper-raised p-4 sm:p-5" data-testid="details-card" data-candidate={key}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={headingId} className="text-h4 font-bold text-ink">
          {candidateName(candidate)}
        </h3>
        <RelationBadge candidate={candidate} />
      </div>

      {rowErrors.map((message) => (
        <Alert key={message} tone="danger" title={message} />
      ))}

      <fieldset className="flex flex-col gap-2" aria-describedby={errors?.modality ? `${groupId}-error` : undefined}>
        <legend className="mb-1 text-label font-semibold text-ink">
          Modalidad<span aria-hidden="true" className="text-danger"> *</span>
        </legend>
        <RadioGroup
          id={groupId}
          value={participant.modalityId ?? ""}
          onValueChange={(value) => onModality(key, value)}
          aria-required
          aria-invalid={errors?.modality ? true : undefined}
          className="grid gap-2"
        >
          {ctx.modalities.map((option) => (
            <ModalityOption key={option.modality_id} candidate={candidate} modality={option} groupId={groupId} />
          ))}
        </RadioGroup>
        <div className="min-h-[1.25rem] text-caption">
          {errors?.modality ? (
            <p id={`${groupId}-error`} role="alert" className="text-danger">
              {errors.modality}
            </p>
          ) : null}
        </div>
      </fieldset>

      {modality && needsCategory ? (
        <FormField id={categoryId} label="Categoría" required errorText={errors?.category} helperText={choices.length === 0 ? "No hay categorías disponibles para esta persona." : undefined}>
          <Select value={participant.categoryId ?? ""} onValueChange={(value) => onCategory(key, value)}>
            <SelectTrigger id={categoryId} invalid={Boolean(errors?.category)} aria-describedby={errors?.category ? `${categoryId}-error` : undefined} aria-required>
              <SelectValue placeholder="Elige una categoría">{selectedCategory?.name}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {choices.map((choice) => (
                <SelectItem key={choice.category_id} value={choice.category_id}>
                  {choice.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
      ) : null}

      {modality && modality.category_mode === "SYSTEM_DERIVES" ? (
        <p className="text-body-sm text-ink-80" data-testid="derived-category">
          <span className="font-semibold text-ink">Categoría:</span> {derived ?? "se asigna automáticamente"}
          {derived ? <span className="text-ink-60"> (se asigna automáticamente)</span> : null}
        </p>
      ) : null}

      {modality && fields.length > 0 ? (
        <div className="grid gap-x-4 gap-y-1 md:grid-cols-2">
          {fields.map((field) => (
            <div key={field.field_key} className={field.field_type === "TEXTAREA" || field.field_type === "MULTISELECT" ? "md:col-span-2" : undefined}>
              <DynamicField
                scope={scope}
                field={field}
                value={participant.responses[field.field_key]}
                error={errors?.fields[field.field_key]}
                onChange={(value) => onResponse(key, field.field_key, value)}
              />
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function StepDetails({
  ctx,
  draft,
  errors,
  rowErrors,
  headingRef,
  onModality,
  onCategory,
  onResponse,
}: {
  ctx: RegistrationContext;
  draft: Draft;
  errors: DetailsErrors;
  rowErrors: Record<string, string[]>;
  headingRef: React.Ref<HTMLHeadingElement>;
  onModality: (candidateKey: string, modalityId: string) => void;
  onCategory: (candidateKey: string, categoryId: string) => void;
  onResponse: (candidateKey: string, fieldKey: string, value: FieldValue | undefined) => void;
}) {
  const selection = orderedSelection(ctx, draft);
  const errorCount = Object.keys(errors).length;
  return (
    <section aria-labelledby="step-details-heading" className="flex flex-col gap-5">
      <StepHeading
        id="step-details-heading"
        ref={headingRef}
        title="Modalidad y datos"
        lead="Elige la modalidad de cada persona y responde lo que pide el evento. El precio y los cupos los confirma el servidor al enviar."
      />
      {errorCount > 0 ? (
        <Alert tone="danger" title="Revisa los datos marcados">
          {errorCount === 1 ? "Hay un participante con datos por corregir." : `Hay ${errorCount} participantes con datos por corregir.`}
        </Alert>
      ) : null}
      {selection.map((candidate) => (
        <ParticipantDetailsCard
          key={candidate.candidate_key}
          ctx={ctx}
          candidate={candidate}
          draft={draft}
          errors={errors[candidate.candidate_key]}
          rowErrors={rowErrors[candidate.candidate_key] ?? []}
          onModality={onModality}
          onCategory={onCategory}
          onResponse={onResponse}
        />
      ))}
    </section>
  );
}

export { fieldControlId };
