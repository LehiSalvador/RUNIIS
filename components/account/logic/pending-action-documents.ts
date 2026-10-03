import type { ApiRequest, ApiResult } from "@/lib/client/api";
import type { PendingActionView } from "@/lib/client/account-types";
import type { RegistrationContext } from "@/lib/shared/registration-context";

/**
 * P2-AC-03.g: the text of an Edition's documents in the /cuenta pending-action dialog.
 *
 * The public legal endpoint is keyed by `document_key`. Platform documents (SPORT_WAIVER, MINOR_TERMS) use their type as the key,
 * but the Edition's EVENT_RULES document has a per-Edition key (`EVENT_RULES_<EDITION>`) that the pending action does not carry:
 * only the registration context lists it. So the card reads the key from the context (existing endpoint) and falls back to the
 * document type, which is what it always used, when the context cannot be read. The text is only shown when the version served
 * is exactly the version the person is about to accept.
 */

export type LegalText = { status: "ready"; markdown: string } | { status: "unavailable" };

type Fetcher = <T>(path: string, request?: ApiRequest) => Promise<ApiResult<T>>;
type ActionDocument = PendingActionView["documents"][number];
type ContextDocumentKeys = Pick<RegistrationContext["documents"][number], "legal_document_version_id" | "document_key">;

/** The key of the public text of one version: the context's (per-Edition) key when listed, else the document type. */
export function documentKeyFor(document: Pick<ActionDocument, "legal_document_version_id" | "document_type">, contextDocuments: readonly ContextDocumentKeys[]): string {
  return contextDocuments.find((listed) => listed.legal_document_version_id === document.legal_document_version_id)?.document_key ?? document.document_type;
}

/** document_key of every document of the Edition, or [] when the context is not readable (the caller then falls back to the type). */
export async function loadEditionDocumentKeys(slug: string, fetcher: Fetcher, signal?: AbortSignal): Promise<ContextDocumentKeys[]> {
  const result = await fetcher<Pick<RegistrationContext, "documents">>(`/api/v1/events/${encodeURIComponent(slug)}/registration-context`, { signal });
  return result.ok && Array.isArray(result.data.documents) ? result.data.documents : [];
}

/** Reads one document's public text; anything but the exact version about to be accepted is "unavailable". */
export async function loadDocumentText(document: ActionDocument, key: string, fetcher: Fetcher, signal?: AbortSignal): Promise<LegalText> {
  const result = await fetcher<{ legal_document_version_id: string; content_markdown: string | null }>(`/api/v1/legal/${encodeURIComponent(key)}`, { signal });
  return result.ok && result.data.legal_document_version_id === document.legal_document_version_id && result.data.content_markdown
    ? { status: "ready", markdown: result.data.content_markdown }
    : { status: "unavailable" };
}

/**
 * Resolves every document's text of one action, reporting each as soon as it arrives. One read of the registration context
 * (for the keys), then one read per document by its key. Aborting (dialog closed) rejects with an AbortError the caller ignores.
 */
export async function loadActionDocumentTexts(
  action: Pick<PendingActionView, "edition" | "documents">,
  fetcher: Fetcher,
  onText: (legalDocumentVersionId: string, text: LegalText) => void,
  signal?: AbortSignal,
): Promise<void> {
  const contextDocuments = await loadEditionDocumentKeys(action.edition.slug, fetcher, signal);
  await Promise.all(
    action.documents.map(async (document) => {
      const text = await loadDocumentText(document, documentKeyFor(document, contextDocuments), fetcher, signal);
      onText(document.legal_document_version_id, text);
    }),
  );
}
