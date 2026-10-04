import { readinessLabel, type ReadinessCheck } from "@/components/admin/readiness-checklist";

/**
 * Catalogue of the Edition state transitions the staff UI offers (Master §32-33). It mirrors, as DISPLAY, the
 * preconditions that private.cfg_edition_transition enforces, so the operator sees what each action needs before
 * pressing it. The server remains the authority: every action still goes to its API route, which re-checks the
 * state and the readiness and answers with its own refusal; nothing here grants or denies anything.
 *
 * Readiness is never recomputed here: `blockedBy` lists the codes the SERVER marked as failing in the editor
 * projection (readiness.publication / readiness.registration).
 */
export type TransitionId =
  | "publish"
  | "hide"
  | "open-registration"
  | "pause-registration"
  | "resume-registration"
  | "close-registration"
  | "postpone"
  | "reschedule"
  | "cancel"
  | "start"
  | "finish";

export type TransitionFields = "none" | "reason" | "postpone" | "reschedule";

export type TransitionSpec = {
  id: TransitionId;
  label: string;
  /** Segment under /api/v1/admin/editions/:id/ */
  endpoint: TransitionId;
  /** What it does, in the operator's words. */
  consequence: string;
  /** The standing requirement, always shown next to the action. */
  precondition: string;
  fields: TransitionFields;
  tone: "primary" | "danger";
  confirmLabel: string;
  group: "publication" | "registration" | "execution";
};

export const TRANSITIONS: Readonly<Record<TransitionId, TransitionSpec>> = {
  publish: {
    id: "publish",
    label: "Publicar edición",
    endpoint: "publish",
    consequence: "La edición aparece en el sitio público con su enlace. Las inscripciones siguen sin abrirse hasta que las abras.",
    precondition: "Requiere estado Borrador y que todos los requisitos de publicación estén cumplidos.",
    fields: "none",
    tone: "primary",
    confirmLabel: "Publicar",
    group: "publication",
  },
  hide: {
    id: "hide",
    label: "Ocultar edición",
    endpoint: "hide",
    consequence: "La edición desaparece del sitio público (búsqueda, inicio y su propia página). No hay acción para volver a publicarla desde aquí.",
    precondition: "Requiere que la edición esté Publicada. Indica el motivo.",
    fields: "reason",
    tone: "danger",
    confirmLabel: "Ocultar edición",
    group: "publication",
  },
  "open-registration": {
    id: "open-registration",
    label: "Abrir inscripciones",
    endpoint: "open-registration",
    consequence: "El público puede enviar solicitudes de inscripción a partir de ahora.",
    precondition: "Requiere inscripciones sin abrir, edición publicada y todos los requisitos de inscripción cumplidos.",
    fields: "none",
    tone: "primary",
    confirmLabel: "Abrir inscripciones",
    group: "registration",
  },
  "pause-registration": {
    id: "pause-registration",
    label: "Pausar inscripciones",
    endpoint: "pause-registration",
    consequence: "Se detienen las solicitudes nuevas. Las que ya existen no se tocan y puedes reanudar después.",
    precondition: "Requiere inscripciones abiertas. Indica el motivo.",
    fields: "reason",
    tone: "primary",
    confirmLabel: "Pausar",
    group: "registration",
  },
  "resume-registration": {
    id: "resume-registration",
    label: "Reanudar inscripciones",
    endpoint: "resume-registration",
    consequence: "Vuelven a aceptarse solicitudes nuevas.",
    precondition: "Requiere inscripciones en pausa y todos los requisitos de inscripción cumplidos.",
    fields: "none",
    tone: "primary",
    confirmLabel: "Reanudar",
    group: "registration",
  },
  "close-registration": {
    id: "close-registration",
    label: "Cerrar inscripciones",
    endpoint: "close-registration",
    consequence: "Se cierran las inscripciones de esta edición. Las solicitudes ya hechas siguen su curso.",
    precondition: "Requiere inscripciones sin abrir, abiertas o en pausa. Indica el motivo.",
    fields: "reason",
    tone: "danger",
    confirmLabel: "Cerrar inscripciones",
    group: "registration",
  },
  postpone: {
    id: "postpone",
    label: "Aplazar carrera",
    endpoint: "postpone",
    consequence: "La carrera queda sin fecha. Las inscripciones nuevas se pausan (o se cierran, si lo eliges) mientras no haya nueva fecha.",
    precondition: "Requiere ejecución Programada. Indica el motivo.",
    fields: "postpone",
    tone: "danger",
    confirmLabel: "Aplazar",
    group: "execution",
  },
  reschedule: {
    id: "reschedule",
    label: "Reprogramar fecha",
    endpoint: "reschedule",
    consequence: "Fija la nueva fecha y hora. El cierre de inscripciones se recalcula si no indicas uno.",
    precondition: "Requiere ejecución Programada o Aplazada. Indica el motivo y la nueva fecha.",
    fields: "reschedule",
    tone: "primary",
    confirmLabel: "Reprogramar",
    group: "execution",
  },
  cancel: {
    id: "cancel",
    label: "Cancelar edición",
    endpoint: "cancel",
    consequence: "Se cierran las inscripciones y se liberan los apartados vigentes. La página se conserva. No se procesa ningún reembolso desde aquí. No se puede deshacer.",
    precondition: "Requiere ejecución Programada o Aplazada. Indica el motivo.",
    fields: "reason",
    tone: "danger",
    confirmLabel: "Cancelar edición",
    group: "execution",
  },
  start: {
    id: "start",
    label: "Iniciar carrera",
    endpoint: "start",
    consequence: "La edición pasa a En curso (día del evento).",
    precondition: "Requiere ejecución Programada y edición ya publicada (no borrador).",
    fields: "none",
    tone: "primary",
    confirmLabel: "Iniciar carrera",
    group: "execution",
  },
  finish: {
    id: "finish",
    label: "Finalizar carrera",
    endpoint: "finish",
    consequence: "La edición pasa a Finalizada, se cierran las inscripciones y el cierre administrativo queda pendiente.",
    precondition: "Requiere ejecución Programada o En curso y edición ya publicada (no borrador).",
    fields: "none",
    tone: "danger",
    confirmLabel: "Finalizar carrera",
    group: "execution",
  },
};

export const TRANSITION_ORDER: readonly TransitionId[] = [
  "publish",
  "hide",
  "open-registration",
  "pause-registration",
  "resume-registration",
  "close-registration",
  "start",
  "finish",
  "postpone",
  "reschedule",
  "cancel",
];

export type EditionStates = {
  publication_state: string;
  registration_state: string;
  execution_state: string;
};

export type ReadinessView = { ready: boolean; checks: readonly ReadinessCheck[] };

export type TransitionAvailability = {
  spec: TransitionSpec;
  /** The current state allows this action at all. */
  applicable: boolean;
  /** Why it does not apply, in plain language (only when !applicable). */
  stateReason: string | null;
  /** Readiness conditions the server reports as failing for this action (only when applicable). */
  blockedBy: { code: string; label: string }[];
  /** Applicable and nothing blocks it: the button is enabled. */
  enabled: boolean;
};

const PUBLICATION_LABEL: Record<string, string> = { DRAFT: "Borrador", PUBLISHED: "Publicada", HIDDEN: "Oculta" };
const REGISTRATION_LABEL: Record<string, string> = { NOT_OPEN: "Sin abrir", OPEN: "Abiertas", PAUSED: "En pausa", CLOSED: "Cerradas" };
const EXECUTION_LABEL: Record<string, string> = {
  SCHEDULED: "Programada",
  POSTPONED: "Aplazada",
  IN_PROGRESS: "En curso",
  FINISHED: "Finalizada",
  CANCELED: "Cancelada",
};

function failing(view: ReadinessView): { code: string; label: string }[] {
  return view.checks.filter((check) => !check.ok).map((check) => ({ code: check.code, label: readinessLabel(check.code) }));
}

/**
 * Every transition with its availability for the given states and the server's readiness result. `applicable`
 * follows the state machine; `blockedBy` is the server's own list of failing conditions for publish / open /
 * resume, so the publish button is disabled with the missing items listed (P3-AC-06).
 */
export function editionTransitions(
  states: EditionStates,
  readiness: { publication: ReadinessView; registration: ReadinessView },
): TransitionAvailability[] {
  const { publication_state: pub, registration_state: reg, execution_state: exec } = states;
  const notDraft = pub !== "DRAFT";

  const rule = (id: TransitionId): { applicable: boolean; reason: string | null } => {
    switch (id) {
      case "publish":
        return pub === "DRAFT" ? { applicable: true, reason: null } : { applicable: false, reason: `Solo un borrador se publica (la edición está ${PUBLICATION_LABEL[pub] ?? pub}).` };
      case "hide":
        return pub === "PUBLISHED" ? { applicable: true, reason: null } : { applicable: false, reason: `Solo se oculta una edición publicada (está ${PUBLICATION_LABEL[pub] ?? pub}).` };
      case "open-registration":
        return reg === "NOT_OPEN" ? { applicable: true, reason: null } : { applicable: false, reason: `Las inscripciones ya no están sin abrir (están ${REGISTRATION_LABEL[reg] ?? reg}).` };
      case "pause-registration":
        return reg === "OPEN" ? { applicable: true, reason: null } : { applicable: false, reason: `Solo se pausan inscripciones abiertas (están ${REGISTRATION_LABEL[reg] ?? reg}).` };
      case "resume-registration":
        return reg === "PAUSED" ? { applicable: true, reason: null } : { applicable: false, reason: `Solo se reanudan inscripciones en pausa (están ${REGISTRATION_LABEL[reg] ?? reg}).` };
      case "close-registration":
        return reg !== "CLOSED" ? { applicable: true, reason: null } : { applicable: false, reason: "Las inscripciones ya están cerradas." };
      case "postpone":
        return exec === "SCHEDULED" ? { applicable: true, reason: null } : { applicable: false, reason: `Solo se aplaza una carrera programada (está ${EXECUTION_LABEL[exec] ?? exec}).` };
      case "reschedule":
        return exec === "SCHEDULED" || exec === "POSTPONED"
          ? { applicable: true, reason: null }
          : { applicable: false, reason: `Solo se reprograma una carrera programada o aplazada (está ${EXECUTION_LABEL[exec] ?? exec}).` };
      case "cancel":
        return exec === "SCHEDULED" || exec === "POSTPONED"
          ? { applicable: true, reason: null }
          : { applicable: false, reason: `Solo se cancela una carrera programada o aplazada (está ${EXECUTION_LABEL[exec] ?? exec}).` };
      case "start":
        if (exec !== "SCHEDULED") return { applicable: false, reason: `Solo inicia una carrera programada (está ${EXECUTION_LABEL[exec] ?? exec}).` };
        return notDraft ? { applicable: true, reason: null } : { applicable: false, reason: "Publica la edición antes de iniciar la carrera." };
      case "finish":
        if (exec !== "SCHEDULED" && exec !== "IN_PROGRESS") return { applicable: false, reason: `Solo se finaliza una carrera programada o en curso (está ${EXECUTION_LABEL[exec] ?? exec}).` };
        return notDraft ? { applicable: true, reason: null } : { applicable: false, reason: "Publica la edición antes de finalizar la carrera." };
    }
  };

  return TRANSITION_ORDER.map((id) => {
    const { applicable, reason } = rule(id);
    const spec = TRANSITIONS[id];
    const blockedBy = !applicable
      ? []
      : id === "publish"
        ? failing(readiness.publication)
        : id === "open-registration" || id === "resume-registration"
          ? failing(readiness.registration)
          : [];
    return { spec, applicable, stateReason: applicable ? null : reason, blockedBy, enabled: applicable && blockedBy.length === 0 };
  });
}

/** The default reading of a missing readiness (should not happen: the projection always carries both). */
export const NO_READINESS: ReadinessView = { ready: false, checks: [] };
