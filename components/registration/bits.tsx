"use client";

import React from "react";
import { cn } from "@/lib/client/cn";
import type { RegistrationCandidate } from "@/lib/shared/registration-context";
import { RELATION_LABELS } from "./logic/copy";

/** Focus a form control by id; groups (radio/checkbox sets) expose suffixed ids instead of the bare one. */
export function focusControl(id: string): boolean {
  const element = document.getElementById(id) ?? document.getElementById(`${id}-yes`);
  if (!element) return false;
  // Centered, so the sticky header never covers the control that just received focus.
  element.focus({ preventScroll: true });
  element.scrollIntoView({ block: "center" });
  return true;
}

/** DOM-id scope of one participant's card (step-details and the first-invalid-control focus agree on it). */
export function participantScope(candidateKey: string): string {
  return `p-${candidateKey.replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

export function candidateName(candidate: Pick<RegistrationCandidate, "relation" | "display_name">): string {
  if (candidate.relation === "SELF") return `${candidate.display_name ?? "Tú"} (tú)`;
  return candidate.display_name ?? (candidate.relation === "GUEST" ? "Invitado" : "Participante");
}

/** ui-spec §3.5 kind pill: PROFILE vs GUEST stay visibly consistent in every participant row (UX F6). */
export function RelationBadge({ candidate }: { candidate: Pick<RegistrationCandidate, "relation" | "participant_kind" | "is_minor"> }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="inline-flex items-center rounded-full bg-paper-sunken px-2.5 py-0.5 text-caption font-semibold text-ink-80">
        {candidate.participant_kind === "GUEST" ? "Invitado" : "Cuenta"}
      </span>
      {candidate.relation !== "SELF" && candidate.relation !== "GUEST" ? (
        <span className="inline-flex items-center rounded-full bg-paper-sunken px-2.5 py-0.5 text-caption font-semibold text-ink-80">{RELATION_LABELS[candidate.relation]}</span>
      ) : null}
      {candidate.is_minor ? (
        <span className="inline-flex items-center rounded-full bg-paper-sunken px-2.5 py-0.5 text-caption font-semibold text-ink-80">Menor de edad</span>
      ) : null}
    </span>
  );
}

/** A step's heading is the focus target when the step changes (keyboard and screen-reader users land on it). */
export const StepHeading = React.forwardRef<HTMLHeadingElement, { id: string; title: string; lead?: string; className?: string }>(
  ({ id, title, lead, className }, ref) => (
    <div className={cn("flex flex-col gap-1", className)}>
      <h2 id={id} ref={ref} tabIndex={-1} className="font-display text-h3 font-bold text-ink outline-none">
        {title}
      </h2>
      {lead ? <p className="max-w-[var(--container-reading)] text-body text-ink-80">{lead}</p> : null}
    </div>
  ),
);
StepHeading.displayName = "StepHeading";
