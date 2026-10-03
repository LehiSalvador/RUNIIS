"use client";

import React from "react";
import { RotateCw, UserPlus } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/client/cn";
import { pluralize } from "@/lib/client/account-format";
import type { RegistrationContext } from "@/lib/shared/registration-context";
import { candidateName, RelationBadge, StepHeading } from "./bits";
import { candidateState, maxParticipants, type Draft } from "./logic/model";

/**
 * Step 1 (ux-spec J1 step 2): exactly the people the server offers. Anyone it marks ineligible stays visible,
 * disabled, with the reason programmatically tied to the control (ui-spec RegistrationParticipantCard), so
 * an invalid combination cannot be submitted and the reason is never hidden in a tooltip.
 */
export function StepParticipants({
  ctx,
  draft,
  rowErrors,
  headingRef,
  onToggle,
  onRefresh,
  refreshing,
}: {
  ctx: RegistrationContext;
  draft: Draft;
  rowErrors: Record<string, string[]>;
  headingRef: React.Ref<HTMLHeadingElement>;
  onToggle: (candidateKey: string, on: boolean) => void;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const limit = maxParticipants(ctx);
  const full = draft.selected.length >= limit;
  const selectableCount = ctx.candidates.filter((candidate) => candidateState(ctx, candidate).selectable).length;

  return (
    <section aria-labelledby="step-participants-heading" className="flex flex-col gap-5">
      <StepHeading
        id="step-participants-heading"
        ref={headingRef}
        title="¿Quién se inscribe?"
        lead="Elige a las personas de esta solicitud. Puedes inscribirte tú y a quienes tienes en tu cuenta."
      />

      {ctx.candidates.length === 0 ? (
        <Alert tone="info" title="Todavía no hay personas para inscribir">
          Tu perfil no puede inscribirse en este momento. Si crees que es un error, contacta a soporte.
        </Alert>
      ) : (
        <ul className="divide-y divide-divider rounded-card border border-divider bg-paper-raised" aria-label="Personas que puedes inscribir">
          {ctx.candidates.map((candidate) => {
            const key = candidate.candidate_key;
            const state = candidateState(ctx, candidate);
            const checked = draft.selected.includes(key);
            const blockedByLimit = !checked && full && state.selectable;
            const disabled = !state.selectable || blockedByLimit;
            const reasonId = `reason-${key}`;
            const reason = !state.selectable ? state.reason : blockedByLimit ? `Una solicitud admite máximo ${limit} participantes.` : null;
            const errors = rowErrors[key] ?? [];
            const labelId = `participant-label-${key}`;
            return (
              <li key={key} className={cn("flex items-start gap-3 p-4", disabled && !checked && "bg-paper-sunken/60")} data-testid="candidate-row" data-candidate={key}>
                <Checkbox
                  id={`participant-${key}`}
                  checked={checked}
                  disabled={disabled && !checked}
                  aria-labelledby={labelId}
                  aria-describedby={reason ? reasonId : undefined}
                  onCheckedChange={(next) => onToggle(key, next === true)}
                  className="-my-2.5 -ml-2.5"
                />
                <div className="min-w-0 flex-1 pt-0.5">
                  <label id={labelId} htmlFor={`participant-${key}`} className="flex flex-wrap items-center gap-2 text-body font-semibold text-ink">
                    <span>{candidateName(candidate)}</span>
                    <RelationBadge candidate={candidate} />
                  </label>
                  {reason ? (
                    <p id={reasonId} className="mt-1 text-body-sm text-ink-80">
                      {reason}
                    </p>
                  ) : null}
                  {errors.map((message) => (
                    <p key={message} role="alert" className="mt-1 text-body-sm font-semibold text-danger">
                      {message}
                    </p>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {ctx.candidates_truncated.friends || ctx.candidates_truncated.guests ? (
        <p className="text-body-sm text-ink-60">Mostramos hasta 100 amistades y 100 invitados. Si falta alguien, inscríbelo en otra solicitud.</p>
      ) : null}

      <div className="flex flex-col gap-3 rounded-card border border-divider bg-paper-raised p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <UserPlus className="mt-0.5 size-5 shrink-0 text-ink-60" aria-hidden="true" />
          <div>
            <p className="text-body font-semibold text-ink">¿Falta alguien?</p>
            <p className="text-body-sm text-ink-60">
              Agrega{" "}
              <a href="/cuenta/amigos" target="_blank" rel="noopener noreferrer" className="font-semibold text-ink underline underline-offset-4">
                amistades<span className="sr-only"> (se abre en una pestaña nueva)</span>
              </a>
              ,{" "}
              <a href="/cuenta/invitados" target="_blank" rel="noopener noreferrer" className="font-semibold text-ink underline underline-offset-4">
                invitados<span className="sr-only"> (se abre en una pestaña nueva)</span>
              </a>{" "}
              o{" "}
              <a href="/cuenta/menores" target="_blank" rel="noopener noreferrer" className="font-semibold text-ink underline underline-offset-4">
                menores a tu cargo<span className="sr-only"> (se abre en una pestaña nueva)</span>
              </a>{" "}
              y vuelve a actualizar la lista.
            </p>
          </div>
        </div>
        <Button variant="secondary" size="md" loading={refreshing} onClick={onRefresh} className="shrink-0">
          <RotateCw className="size-4" aria-hidden="true" />
          Actualizar lista
        </Button>
      </div>

      <p className="text-body-sm text-ink-60" role="status">
        {draft.selected.length === 0
          ? selectableCount === 0
            ? "Nadie puede inscribirse por ahora."
            : "Aún no has elegido a nadie."
          : `${pluralize(draft.selected.length, "participante elegido", "participantes elegidos")} de ${limit} como máximo.`}
      </p>
    </section>
  );
}
