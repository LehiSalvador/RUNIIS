"use client";

import React from "react";
import { CircleCheck } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { LegalDocumentButton } from "@/components/registration/legal-document-dialog";
import {
  ACCOUNT_LEGAL_TITLES,
  isAccountLegalFailure,
  legalDocumentsPhrase,
  legalVersionsKey,
  pendingLegalDocuments,
  publicLegalPath,
  type AccountLegalDocument,
} from "@/components/account/logic/legal";
import { apiFetch, type ApiFailure } from "@/lib/client/api";
import { errorMessage } from "@/lib/client/account-errors";
import type { AccountLegalStatusResponse } from "@/lib/shared/legal";

/**
 * OWN-05 consent line: one explicit, never pre-ticked checkbox for the TERMS_OF_SERVICE / PRIVACY_NOTICE versions on screen.
 * Each version links to its public page (new tab, so the form is not lost). The caller owns the tick and binds it to the exact
 * version ids (`legalVersionsKey`), so a version published meanwhile cancels it.
 */
export function LegalConsent({
  id,
  documents,
  checked,
  onCheckedChange,
  error,
  checkboxRef,
}: {
  id: string;
  documents: readonly AccountLegalDocument[];
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  error?: string;
  checkboxRef?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <div>
      <div className="flex items-start gap-1">
        <Checkbox
          ref={checkboxRef}
          id={id}
          checked={checked}
          onCheckedChange={(next) => onCheckedChange(next === true)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className="-ml-3 -mt-2.5"
        />
        <label htmlFor={id} className="text-body text-ink">
          He leído y acepto{" "}
          {documents.map((document, index) => (
            <React.Fragment key={document.legal_document_version_id}>
              {index > 0 ? " y " : null}
              <a href={publicLegalPath(document.document_type)} target="_blank" rel="noopener" className="font-semibold underline underline-offset-4">
                {document.document_type === "TERMS_OF_SERVICE" ? "los " : "el "}
                {ACCOUNT_LEGAL_TITLES[document.document_type]} (versión {document.version})
                <span className="sr-only"> (se abre en una pestaña nueva)</span>
              </a>
            </React.Fragment>
          ))}
          .
        </label>
      </div>
      <div className="min-h-[1.25rem] pl-8 text-caption">
        {error ? (
          <p id={`${id}-error`} role="alert" className="text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Re-acceptance screen (OWN-05): shown when a newer TERMS_OF_SERVICE / PRIVACY_NOTICE was published. It has no dismiss action:
 * the only way forward is to accept (or leave the page; the account banner and the registration flow keep asking). Acceptance
 * is the person's explicit tick; the ids sent are the versions displayed, and a version that moved meanwhile refreshes the list.
 */
export function LegalReacceptance({ initial, next }: { initial: AccountLegalStatusResponse; next: string }) {
  const [status, setStatus] = React.useState(initial);
  const pendingDocs = pendingLegalDocuments(status.documents);
  const key = legalVersionsKey(pendingDocs);
  const [tickedFor, setTickedFor] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const [notice, setNotice] = React.useState<{ tone: "danger" | "info"; text: string } | null>(null);
  const checkbox = React.useRef<HTMLButtonElement>(null);
  const checked = tickedFor === key && key !== "";

  async function accept() {
    if (!checked || pending) return;
    setPending(true);
    setNotice(null);
    const result = await apiFetch<AccountLegalStatusResponse>("/api/v1/me/legal/accept", {
      method: "POST",
      body: { legal_document_version_ids: pendingDocs.map((document) => document.legal_document_version_id) },
    });
    if (result.ok) {
      // Full navigation: the account banner (server layout) must re-read the acceptance.
      window.location.assign(next);
      return;
    }
    setPending(false);
    await handleFailure(result);
  }

  async function handleFailure(failure: ApiFailure) {
    if (isAccountLegalFailure(failure)) {
      // A version was superseded while the page was open: show the current ones and ask again.
      const fresh = await apiFetch<AccountLegalStatusResponse>("/api/v1/me/legal");
      if (fresh.ok) {
        setStatus(fresh.data);
        setTickedFor(null);
        setNotice({ tone: "info", text: "Se publicó una versión nueva mientras leías. Actualizamos los documentos: léelos y acepta de nuevo." });
        checkbox.current?.focus();
        return;
      }
    }
    setNotice({ tone: "danger", text: errorMessage(failure) });
  }

  if (pendingDocs.length === 0) {
    return (
      <Alert tone="success" title="Tus documentos están al día">
        Aceptaste la versión vigente de {legalDocumentsPhrase(status.documents)}.
      </Alert>
    );
  }

  return (
    <section aria-labelledby="reaccept-heading" className="flex max-w-[var(--container-reading)] flex-col gap-5" data-testid="legal-reacceptance">
      <div>
        <h2 id="reaccept-heading" className="font-display text-h3 font-bold text-ink">
          {status.needs_reacceptance ? "Actualizamos nuestros documentos" : "Acepta los documentos de tu cuenta"}
        </h2>
        <p className="mt-1 text-body text-ink-80">
          {status.needs_reacceptance
            ? "Hay una versión nueva de los documentos de tu cuenta. Necesitamos que la aceptes para poder inscribirte a una carrera."
            : "Para inscribirte a una carrera necesitamos que aceptes los documentos de tu cuenta. Lo haces una sola vez."}
        </p>
      </div>

      <ul className="divide-y divide-divider rounded-card border border-divider bg-paper-raised" aria-label="Documentos por aceptar">
        {pendingDocs.map((document) => (
          <li key={document.legal_document_version_id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2">
            <span className="text-body text-ink">
              {ACCOUNT_LEGAL_TITLES[document.document_type]} <span className="text-body-sm text-ink-60">· versión {document.version}</span>
              {document.accepted_version !== null ? <span className="block text-body-sm text-ink-60">Aceptaste antes la versión {document.accepted_version}.</span> : null}
            </span>
            <LegalDocumentButton documentKey={document.document_key} title={ACCOUNT_LEGAL_TITLES[document.document_type]} version={document.version} />
          </li>
        ))}
      </ul>

      <LegalConsent id="reaccept-legal" documents={pendingDocs} checked={checked} onCheckedChange={(next) => setTickedFor(next ? key : null)} checkboxRef={checkbox} />

      {notice ? (
        <Alert tone={notice.tone} title={notice.tone === "danger" ? "No pudimos registrar tu aceptación" : "Documentos actualizados"}>
          {notice.text}
        </Alert>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button onClick={accept} loading={pending} disabled={!checked} size="lg" className="w-full sm:w-auto">
          <CircleCheck className="size-5" aria-hidden="true" />
          Aceptar y continuar
        </Button>
        <p className="text-caption text-ink-60">Registramos la versión y la fecha de tu aceptación.</p>
      </div>
    </section>
  );
}
