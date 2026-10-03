"use client";

import React from "react";
import { CircleCheck, Copy, RotateCw } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/components/ui/use-toast";
import { LEGAL_DOCUMENT_LABELS } from "@/lib/client/account-format";
import { errorMessage } from "@/lib/client/account-errors";
import type { ApiFailure } from "@/lib/client/api";
import type { RegistrationCandidate, RegistrationContext } from "@/lib/shared/registration-context";
import { candidateName, RelationBadge, StepHeading } from "./bits";
import { LegalDocumentButton } from "./legal-document-dialog";
import { legalStatus, type Draft, type LegalRow } from "./logic/model";

function docTitle(documentType: string | undefined): string {
  return (documentType && LEGAL_DOCUMENT_LABELS[documentType]) || "Documento del evento";
}

/** Account-level TERMS_OF_SERVICE / PRIVACY_NOTICE gate (OWN-05): accepted once, again when a new version is published. */
function AccountLegalGate({ ctx, onAccept }: { ctx: RegistrationContext; onAccept: (versionIds: string[]) => Promise<ApiFailure | null> }) {
  const legal = ctx.account_legal;
  const pendingDocs = legal.documents.filter((document) => document.status !== "ACCEPTED");
  const [tickedFor, setTickedFor] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const [failure, setFailure] = React.useState<ApiFailure | null>(null);
  const ids = pendingDocs.map((document) => document.legal_document_version_id);
  // The tick is bound to the exact versions on screen: if a new version is published meanwhile it no longer counts.
  const idsKey = ids.join(",");
  const checked = tickedFor === idsKey;

  async function accept() {
    if (!checked || pending) return;
    setPending(true);
    setFailure(null);
    const result = await onAccept(ids);
    setPending(false);
    if (result) setFailure(result);
  }

  return (
    <section aria-labelledby="account-legal-heading" className="flex flex-col gap-4 rounded-card border border-warning-border bg-warning-tint p-4 sm:p-5" data-testid="account-legal-gate">
      <div>
        <h3 id="account-legal-heading" className="text-h4 font-bold text-ink">
          {legal.needs_reacceptance ? "Actualizamos nuestros documentos" : "Antes de inscribirte"}
        </h3>
        <p className="mt-1 text-body-sm text-ink-80">
          {legal.needs_reacceptance
            ? "Hay una versión nueva de los documentos de tu cuenta. Necesitamos que la aceptes para poder inscribirte."
            : "Para inscribirte necesitamos que aceptes los documentos de tu cuenta. Lo haces una sola vez."}
        </p>
      </div>
      <ul className="flex flex-col divide-y divide-warning-border/60 rounded-control bg-paper-raised">
        {pendingDocs.map((document) => (
          <li key={document.legal_document_version_id} className="flex items-center justify-between gap-3 px-4 py-2">
            <span className="text-body text-ink">
              {docTitle(document.document_type)} <span className="text-body-sm text-ink-60">· versión {document.version}</span>
            </span>
            <LegalDocumentButton documentKey={document.document_key} title={docTitle(document.document_type)} version={document.version} />
          </li>
        ))}
      </ul>
      <Checkbox
        id="account-legal-accept"
        checked={checked}
        onCheckedChange={(next) => setTickedFor(next === true ? idsKey : null)}
        label={pendingDocs.length === 1 ? `He leído y acepto: ${docTitle(pendingDocs[0].document_type)}` : "He leído y acepto los Términos y condiciones y el Aviso de privacidad"}
      />
      {failure ? (
        <Alert tone="danger" title="No pudimos registrar tu aceptación">
          {failure.code === "LEGAL_ACCEPTANCE_REQUIRED" ? "Se publicó una versión nueva mientras leías. Actualizamos los documentos: léelos y acepta de nuevo." : errorMessage(failure)}
        </Alert>
      ) : null}
      <div>
        <Button onClick={accept} loading={pending} disabled={!checked} className="w-full sm:w-auto">
          Aceptar y continuar
        </Button>
      </div>
    </section>
  );
}

function acceptorLine(candidate: RegistrationCandidate): string | null {
  const name = candidate.display_name ?? "esta persona";
  switch (candidate.acceptance.acceptor) {
    case "GUARDIAN":
      return `Aceptas como responsable de ${name}.`;
    case "OWNER":
      return `Aceptas en nombre de ${name}, a quien registraste como invitado.`;
    case "PARTICIPANT":
      return `${name} debe aceptar personalmente desde su cuenta. Nadie puede aceptar por otra persona adulta.`;
    case "OTHER_GUARDIAN":
      return `${name} es menor y su responsable es otra persona: esa persona debe aceptar desde su cuenta.`;
    default:
      return null;
  }
}

function PendingOther({ candidate, mode, onRefresh, refreshing }: { candidate: RegistrationCandidate; mode: RegistrationContext["edition"]["registration_mode"]; onRefresh: () => void; refreshing: boolean }) {
  const [url, setUrl] = React.useState<string | null>(null);
  const name = candidate.display_name ?? "esta persona";

  async function copy() {
    const link = `${window.location.origin}/cuenta`;
    try {
      await navigator.clipboard.writeText(link);
      toast({ tone: "success", title: "Enlace copiado", description: `Envíaselo a ${name} para que acepte.` });
    } catch {
      setUrl(link);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-control border border-warning-border bg-warning-tint p-3" data-testid="pending-other">
      <p className="text-body-sm font-semibold text-ink">Pendiente de aceptación de {name}</p>
      <p className="text-body-sm text-ink-80">{acceptorLine(candidate)}</p>
      <p className="text-body-sm text-ink-80">
        {mode === "FREE"
          ? "Esta inscripción gratuita se confirma al instante, así que necesitamos su aceptación antes de enviar."
          : "Puedes enviar la solicitud: el organizador no podrá confirmarla hasta que acepte, y debe hacerlo antes de que venza el apartado."}
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        {candidate.acceptance.acceptor === "PARTICIPANT" ? (
          <Button variant="secondary" size="sm" onClick={copy}>
            <Copy className="size-4" aria-hidden="true" />
            Copiar enlace
            <span className="sr-only"> para {name}</span>
          </Button>
        ) : null}
        <Button variant="secondary" size="sm" loading={refreshing} onClick={onRefresh}>
          <RotateCw className="size-4" aria-hidden="true" />
          Ya aceptó, actualizar
          <span className="sr-only"> el estado de {name}</span>
        </Button>
      </div>
      {url ? (
        <p className="text-body-sm text-ink-80">
          Copia este enlace: <span className="break-all font-semibold text-ink">{url}</span>
        </p>
      ) : null}
    </div>
  );
}

function ParticipantLegalCard({
  row,
  mode,
  onAccepted,
  onRefresh,
  refreshing,
  errors,
}: {
  row: LegalRow;
  mode: RegistrationContext["edition"]["registration_mode"];
  onAccepted: (candidateKey: string, versionId: string, accepted: boolean) => void;
  onRefresh: () => void;
  refreshing: boolean;
  errors: string[];
}) {
  const { candidate } = row;
  const key = candidate.candidate_key;
  const canAccept = candidate.acceptance.buyer_can_accept;
  const headingId = `legal-${key.replace(/[^A-Za-z0-9_-]/g, "_")}`;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3 rounded-card border border-divider bg-paper-raised p-4 sm:p-5" data-testid="legal-card" data-candidate={key}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={headingId} className="text-h4 font-bold text-ink">
          {candidateName(candidate)}
        </h3>
        <RelationBadge candidate={candidate} />
      </div>
      {errors.map((message) => (
        <Alert key={message} tone="danger" title={message} />
      ))}
      {row.documents.length === 0 ? <p className="text-body-sm text-ink-60">El evento no pide documentos para esta persona.</p> : null}
      <ul className="flex flex-col">
        {row.documents.map((doc) => {
          const title = docTitle(doc.document?.document_type);
          const version = doc.document?.version ?? 0;
          return (
            <li key={doc.versionId} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-divider first:border-t-0">
              {!doc.missing ? (
                <p className="flex items-center gap-2 py-3 text-body text-ink">
                  <CircleCheck className="size-5 text-success" aria-hidden="true" />
                  <span>
                    {title} <span className="text-body-sm text-ink-60">· aceptado</span>
                  </span>
                </p>
              ) : canAccept ? (
                <Checkbox
                  id={`accept-${key}-${doc.versionId}`}
                  checked={doc.checked}
                  onCheckedChange={(next) => onAccepted(key, doc.versionId, next === true)}
                  label={candidate.acceptance.acceptor === "SELF" ? `Acepto: ${title}` : `${acceptorShort(candidate)}: ${title}`}
                />
              ) : (
                <p className="py-3 text-body text-ink">
                  {title} <span className="text-body-sm text-warning">· pendiente</span>
                </p>
              )}
              {doc.document ? <LegalDocumentButton documentKey={doc.document.document_key} title={title} version={version} /> : null}
            </li>
          );
        })}
      </ul>
      {row.pendingOther ? <PendingOther candidate={candidate} mode={mode} onRefresh={onRefresh} refreshing={refreshing} /> : null}
      {canAccept && row.documents.some((doc) => doc.missing) && acceptorLine(candidate) ? <p className="text-body-sm text-ink-60">{acceptorLine(candidate)}</p> : null}
    </section>
  );
}

function acceptorShort(candidate: RegistrationCandidate): string {
  const name = candidate.display_name ?? "esta persona";
  return candidate.acceptance.acceptor === "GUARDIAN" ? `Acepto como responsable de ${name}` : `Acepto por ${name}`;
}

export function StepLegal({
  ctx,
  draft,
  rowErrors,
  headingRef,
  onAcceptAccount,
  onAccepted,
  onRefresh,
  refreshing,
}: {
  ctx: RegistrationContext;
  draft: Draft;
  rowErrors: Record<string, string[]>;
  headingRef: React.Ref<HTMLHeadingElement>;
  onAcceptAccount: (versionIds: string[]) => Promise<ApiFailure | null>;
  onAccepted: (candidateKey: string, versionId: string, accepted: boolean) => void;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const status = legalStatus(ctx, draft);
  return (
    <section aria-labelledby="step-legal-heading" className="flex flex-col gap-5">
      <StepHeading
        id="step-legal-heading"
        ref={headingRef}
        title="Documentos legales"
        lead="Cada persona acepta los documentos del evento. Tú aceptas por ti y por quienes tienes a tu cargo; las demás personas adultas aceptan desde su propia cuenta."
      />
      {status.accountPending ? <AccountLegalGate ctx={ctx} onAccept={onAcceptAccount} /> : null}
      {status.rows.map((row) => (
        <ParticipantLegalCard
          key={row.candidate.candidate_key}
          row={row}
          mode={ctx.edition.registration_mode}
          onAccepted={onAccepted}
          onRefresh={onRefresh}
          refreshing={refreshing}
          errors={rowErrors[row.candidate.candidate_key] ?? []}
        />
      ))}
    </section>
  );
}
