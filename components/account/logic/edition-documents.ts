import type { PendingActionView } from "@/lib/client/account-types";
import type { RegistrationContext } from "@/lib/shared/registration-context";

/**
 * Master §124 / P2-AC-03.c: the edition-scoped "accept the event documents" screen. An adult Friend accepts personally; a
 * guardian accepts for a minor. Nobody ever accepts for another adult, and nothing is pre-ticked.
 */

export type EditionAcceptanceSubject = PendingActionView["subject"];

export type EditionAcceptanceDocument = {
  legal_document_version_id: string;
  document_type: string;
  /** Key of the public text (`GET /api/v1/legal/{key}`); falls back to the type when the context did not list the version. */
  document_key: string;
  version: number;
};

export type EditionAcceptanceItem = {
  /** Stable per person (SELF, minor profile or minor guest) for React keys and element ids. */
  key: string;
  subject: EditionAcceptanceSubject;
  documents: EditionAcceptanceDocument[];
};

export type EditionAcceptanceEdition = { edition_id: string; name: string; slug: string };

/** Deep link to the screen (the buyer's "Copiar enlace"). Signed-out visitors go through /entrar?next= and come back here. */
export function editionDocumentsPath(slug: string): string {
  return `/cuenta/documentos/evento/${encodeURIComponent(slug)}`;
}

export function subjectKey(subject: EditionAcceptanceSubject): string {
  if (subject.kind === "SELF") return "self";
  if (subject.kind === "MINOR_PROFILE") return `profile:${subject.public_profile_id ?? ""}`;
  return `guest:${subject.guest_participant_id}`;
}

type ContextDocument = Pick<RegistrationContext["documents"][number], "legal_document_version_id" | "document_type" | "document_key" | "version">;

function toDocuments(
  documents: readonly { legal_document_version_id: string; document_type: string; version: number }[],
  contextDocuments: readonly ContextDocument[],
): EditionAcceptanceDocument[] {
  return documents.map((document) => {
    const listed = contextDocuments.find((candidate) => candidate.legal_document_version_id === document.legal_document_version_id);
    return {
      legal_document_version_id: document.legal_document_version_id,
      document_type: document.document_type,
      document_key: listed?.document_key ?? document.document_type,
      version: document.version,
    };
  });
}

/**
 * Everything this person must accept for the edition, from ONE source: GET /me/pending-actions?edition_id=. Since P2-G3 it lists, for
 * an OPEN edition and before any request exists, the person's own missing acceptance (SELF) and one item per minor they are the
 * ACTIVE guardian of (MINOR_PROFILE, MINOR_GUEST whoever owns the Guest), plus the actions of any pending request for this edition.
 * Other editions' actions are not shown here. The registration context only supplies each version's public text key.
 */
export function buildEditionAcceptanceItems({
  editionId,
  actions,
  contextDocuments,
}: {
  editionId: string;
  actions: readonly PendingActionView[];
  contextDocuments: readonly ContextDocument[];
}): EditionAcceptanceItem[] {
  const items = new Map<string, EditionAcceptanceItem>();

  for (const action of actions) {
    if (action.edition.edition_id !== editionId || action.documents.length === 0) continue;
    const key = subjectKey(action.subject);
    if (!items.has(key)) items.set(key, { key, subject: action.subject, documents: toDocuments(action.documents, contextDocuments) });
  }

  // Own acceptance first, then the minors, each group in a stable order.
  return [...items.values()].sort((a, b) => Number(b.subject.kind === "SELF") - Number(a.subject.kind === "SELF") || a.key.localeCompare(b.key));
}

/** Body of POST /api/v1/me/pending-actions/accept-documents: exactly the versions shown, for the person they belong to. */
export function acceptDocumentsBody(editionId: string, item: EditionAcceptanceItem): Record<string, unknown> {
  const body: Record<string, unknown> = {
    edition_id: editionId,
    legal_document_version_ids: item.documents.map((document) => document.legal_document_version_id),
  };
  if (item.subject.kind === "MINOR_PROFILE" && item.subject.public_profile_id) body.minor_public_profile_id = item.subject.public_profile_id;
  if (item.subject.kind === "MINOR_GUEST") body.minor_guest_participant_id = item.subject.guest_participant_id;
  return body;
}

/** A tick binds to the exact versions on screen; a version that changes under the page cancels it. */
export function acceptanceVersionsKey(item: Pick<EditionAcceptanceItem, "documents">): string {
  return item.documents.map((document) => document.legal_document_version_id).join(",");
}

/** What the person sees when recording the acceptance failed. `refresh` means the documents moved: reload, read and accept again. */
export function acceptFailureCopy(failure: { code: string; details: Record<string, unknown> }): { text: string; refresh: boolean; signIn: boolean } {
  switch (failure.code) {
    case "AUTH_REQUIRED":
      return { text: "Tu sesión terminó. Inicia sesión de nuevo para aceptar.", refresh: false, signIn: true };
    case "RATE_LIMITED":
      return { text: "Intentaste muchas veces. Espera un momento antes de aceptar de nuevo.", refresh: false, signIn: false };
    case "VALIDATION_ERROR":
    case "NOT_FOUND":
    case "CONFLICT":
    case "RESOURCE_EXPIRED":
      return { text: "Los documentos cambiaron o ya no aplican. Actualiza la página, léelos y acepta de nuevo.", refresh: true, signIn: false };
    case "BUSINESS_RULE_VIOLATION":
      return {
        text:
          failure.details.reason === "GUARDIAN_ACCEPTANCE_REQUIRED"
            ? "Eres menor de edad: tu madre, padre o tutor acepta estos documentos desde su cuenta."
            : "Esta aceptación no está permitida en este momento.",
        refresh: false,
        signIn: false,
      };
    case "NETWORK_ERROR":
      return { text: "No pudimos conectar. Revisa tu conexión e intenta de nuevo.", refresh: false, signIn: false };
    default:
      return { text: "No pudimos registrar tu aceptación. Intenta de nuevo.", refresh: false, signIn: false };
  }
}
