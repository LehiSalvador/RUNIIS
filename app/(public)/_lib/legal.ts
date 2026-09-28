import "server-only";
import type { Metadata } from "next";
import type { LegalDocumentState } from "@/components/public/legal-document";
import { LEGAL_DOCUMENTS, cachedLegalDocument } from "@/app/(public)/_lib/data";
import { pageMetadata } from "@/app/(public)/_lib/seo";

export type LegalSlug = keyof typeof LEGAL_DOCUMENTS;

export async function loadLegalDocument(slug: LegalSlug): Promise<LegalDocumentState> {
  try {
    const document = await cachedLegalDocument(LEGAL_DOCUMENTS[slug].key);
    if (!document) return { status: "missing" };
    return { status: "published", markdown: document.content_markdown, version: document.version, publishedAt: document.published_at };
  } catch {
    return { status: "error" };
  }
}

/** Unpublished (or unreadable) documents are noindex: an empty placeholder is not a legal page. */
export async function legalMetadata(slug: LegalSlug): Promise<Metadata> {
  const { title, path } = LEGAL_DOCUMENTS[slug];
  const state = await loadLegalDocument(slug);
  return pageMetadata({
    title,
    description: state.status === "published" ? `${title} de RUNIIS, versión ${state.version}.` : `${title} de RUNIIS (documento en preparación).`,
    path,
    noindex: state.status !== "published",
    type: "article",
  });
}
