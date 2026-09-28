import React from "react";
import type { Metadata } from "next";
import { LegalDocument } from "@/components/public/legal-document";
import { LEGAL_DOCUMENTS } from "@/app/(public)/_lib/data";
import { legalMetadata, loadLegalDocument } from "@/app/(public)/_lib/legal";

export const revalidate = 300;

export function generateMetadata(): Promise<Metadata> {
  return legalMetadata("privacidad");
}

export default async function PrivacidadPage() {
  return <LegalDocument title={LEGAL_DOCUMENTS.privacidad.title} state={await loadLegalDocument("privacidad")} />;
}
