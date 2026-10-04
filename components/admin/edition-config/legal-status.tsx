import React from "react";
import { CircleAlert, CircleCheck } from "lucide-react";
import { Panel } from "@/components/admin/panel";
import { formatDateTime } from "@/components/admin/format";

type LegalDocument = {
  document_key: string;
  document_type: string;
  status: string;
  edition_id: string | null;
  current_version: { version: number; published_at: string | null } | null;
};

const REQUIRED: readonly { type: string; label: string; note: string }[] = [
  { type: "TERMS_OF_SERVICE", label: "Términos del servicio", note: "Página del sitio y alta de cuenta." },
  { type: "PRIVACY_NOTICE", label: "Aviso de privacidad", note: "Página del sitio y alta de cuenta." },
  { type: "SPORT_WAIVER", label: "Exención deportiva", note: "La acepta cada persona que se inscribe." },
  { type: "MINOR_TERMS", label: "Términos para menores", note: "Solo se exige si hay modalidades abiertas a menores de 18 años." },
];

/** Read-only status of the legal documents registration depends on (Master §123): the server decides, this only shows what is published. */
export function LegalStatus({ editionId, documents, timezone }: { editionId: string; documents: readonly LegalDocument[]; timezone: string }) {
  const published = (type: string) =>
    documents.find((doc) => doc.document_type === type && doc.status === "ACTIVE" && doc.edition_id === null && doc.current_version !== null) ?? null;
  const rules = documents.filter((doc) => doc.document_type === "EVENT_RULES" && doc.status === "ACTIVE" && doc.edition_id === editionId);

  return (
    <Panel
      title="Documentos legales"
      description="Son globales: valen para todas las ediciones. Para abrir inscripciones deben estar publicados."
    >
      <ul className="divide-y divide-divider" data-testid="legal-status">
        {REQUIRED.map((entry) => {
          const doc = published(entry.type);
          return (
            <li key={entry.type} className="flex flex-wrap items-start justify-between gap-2 py-2 first:pt-0 last:pb-0" data-legal-type={entry.type}>
              <div className="flex items-start gap-2">
                {doc ? (
                  <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
                ) : (
                  <CircleAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" />
                )}
                <div>
                  <p className="text-body-sm font-semibold text-ink">
                    <span className="sr-only">{doc ? "Publicado: " : "Sin publicar: "}</span>
                    {entry.label}
                  </p>
                  <p className="text-caption text-ink-60">{entry.note}</p>
                </div>
              </div>
              <p className="text-caption text-ink-60">
                {doc?.current_version ? `v${doc.current_version.version} · ${formatDateTime(doc.current_version.published_at, timezone)}` : "Sin versión publicada"}
              </p>
            </li>
          );
        })}
        {rules.map((doc) => (
          <li key={doc.document_key} className="flex flex-wrap items-start justify-between gap-2 py-2 last:pb-0" data-legal-type="EVENT_RULES">
            <div className="flex items-start gap-2">
              {doc.current_version ? (
                <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
              ) : (
                <CircleAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" />
              )}
              <div>
                <p className="text-body-sm font-semibold text-ink">
                  <span className="sr-only">{doc.current_version ? "Publicado: " : "Sin publicar: "}</span>
                  Reglamento de esta edición
                </p>
                <p className="text-caption text-ink-60">Propio de la edición; se exige si existe.</p>
              </div>
            </div>
            <p className="text-caption text-ink-60">{doc.current_version ? `v${doc.current_version.version}` : "Sin versión publicada"}</p>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-caption text-ink-60">
        Esta pantalla solo muestra el estado. Redactar y publicar documentos legales todavía no tiene pantalla en el panel; el servidor sigue exigiéndolos al abrir inscripciones.
      </p>
    </Panel>
  );
}
