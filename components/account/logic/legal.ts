import type { AccountLegalDocumentType, AccountLegalStatus } from "@/lib/shared/legal";

/** Public page of each account-level document (the text the person is accepting; versions come from GET /me/legal). */
const PUBLIC_PATHS: Record<AccountLegalDocumentType, string> = {
  TERMS_OF_SERVICE: "/legal/terminos",
  PRIVACY_NOTICE: "/legal/privacidad",
};

export const ACCOUNT_LEGAL_TITLES: Record<AccountLegalDocumentType, string> = {
  TERMS_OF_SERVICE: "Términos y condiciones",
  PRIVACY_NOTICE: "Aviso de privacidad",
};

export type AccountLegalDocument = AccountLegalStatus["documents"][number];

export function publicLegalPath(documentType: AccountLegalDocumentType): string {
  return PUBLIC_PATHS[documentType];
}

/** The documents the person still has to accept (first acceptance or a newer version), Terms before Privacy (the API orders by type name). */
export function pendingLegalDocuments(documents: readonly AccountLegalDocument[]): AccountLegalDocument[] {
  const rank = (document: AccountLegalDocument) => (document.document_type === "TERMS_OF_SERVICE" ? 0 : 1);
  return documents.filter((document) => document.status !== "ACCEPTED").sort((a, b) => rank(a) - rank(b));
}

/** Binds a tick to the exact versions on screen: when a version changes under the page the tick no longer counts. */
export function legalVersionsKey(documents: readonly Pick<AccountLegalDocument, "legal_document_version_id">[]): string {
  return documents.map((document) => document.legal_document_version_id).join(",");
}

/** Short sentence naming the documents ("los Términos y condiciones y el Aviso de privacidad"). */
export function legalDocumentsPhrase(documents: readonly Pick<AccountLegalDocument, "document_type">[]): string {
  const names = documents.map((document) => (document.document_type === "TERMS_OF_SERVICE" ? "los Términos y condiciones" : "el Aviso de privacidad"));
  return names.length === 2 ? `${names[0]} y ${names[1]}` : (names[0] ?? "");
}

/** `details.scope === "ACCOUNT"` LEGAL_ACCEPTANCE_REQUIRED: a version moved or a document was not accepted. */
export function isAccountLegalFailure(failure: { code: string; details: Record<string, unknown> }): boolean {
  return failure.code === "LEGAL_ACCEPTANCE_REQUIRED" && failure.details.scope === "ACCOUNT";
}
