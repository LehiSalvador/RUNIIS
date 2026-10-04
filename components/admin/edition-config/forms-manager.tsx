"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, FilePlus2, Pencil, Save, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";
import { apiFetch, type ApiFailure } from "@/lib/client/api";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { Panel } from "@/components/admin/panel";
import { RefusalNotice } from "@/components/admin/events/fields";
import { AdminBadge } from "@/components/admin/status-badges";
import { formatDateTime } from "@/components/admin/format";
import { FieldEditorList } from "@/components/admin/edition-config/form-field-editor";
import { FormPreview } from "@/components/admin/edition-config/form-preview";
import { apiPut } from "@/components/admin/edition-config/put-request";
import {
  buildFieldBody,
  buildFieldsBody,
  describeFieldRules,
  fieldDraftFromServer,
  fieldsSignature,
  validateFieldDrafts,
  type FieldDraft,
  type FieldDraftErrors,
} from "@/components/admin/edition-config/form-field-logic";
import type { FormScope, FormVersion } from "@/components/admin/edition-config/config-model";
import { CircleCheck, CircleDashed, History } from "lucide-react";

/** Registration forms by audience (Master §41). A published version is immutable: editing creates a draft that replaces it when published. */
export function FormsManager({
  editionId,
  scopes,
  timezone,
  frozen,
}: {
  editionId: string;
  scopes: readonly FormScope[];
  timezone: string;
  frozen: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      {scopes.map((scope) => (
        <ScopePanel key={scope.key} editionId={editionId} scope={scope} timezone={timezone} frozen={frozen} />
      ))}
    </div>
  );
}

function previewFields(drafts: readonly FieldDraft[]) {
  return drafts.map((draft, index) => {
    const body = buildFieldBody({ ...draft, label: draft.label.trim() || "(pregunta sin texto)", field_key: draft.field_key || `campo_${index + 1}` }, index);
    return {
      field_key: String(body.field_key),
      label: String(body.label),
      field_type: draft.field_type,
      required: draft.required,
      validation_config: body.validation_config as Record<string, unknown>,
      options_config: body.options_config as Record<string, unknown>,
      sort_order: index + 1,
    };
  });
}

function serverPreview(version: FormVersion) {
  return version.fields.map((field, index) => ({
    field_key: field.field_key,
    label: field.label,
    field_type: field.field_type,
    required: field.required,
    validation_config: field.validation_config,
    options_config: field.options_config,
    sort_order: field.sort_order ?? index + 1,
  }));
}

function ScopePanel({ editionId, scope, timezone, frozen }: { editionId: string; scope: FormScope; timezone: string; frozen: boolean }) {
  const router = useRouter();
  const [failure, setFailure] = React.useState<ApiFailure | null>(null);
  const [pending, setPending] = React.useState(false);
  const [showPublishedPreview, setShowPublishedPreview] = React.useState(false);
  const { published, draft, history } = scope;
  const heading = scope.modalityId ? `Formulario de ${scope.name}` : "Formulario de todas las modalidades";
  const nothing = !published && !draft;

  async function createDraft() {
    if (pending) return;
    setPending(true);
    setFailure(null);
    try {
      const result = await apiFetch(`/api/v1/admin/editions/${editionId}/forms`, {
        method: "POST",
        body: { ...(scope.modalityId ? { modality_id: scope.modalityId } : {}), copy_published_fields: true },
      });
      if (!result.ok) {
        setFailure(result);
        return;
      }
      toast({ tone: "success", title: published ? `Borrador de la versión ${published.version + 1} creado` : "Formulario creado como borrador" });
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <Panel
      title={heading}
      description={
        scope.modalityId
          ? "Preguntas adicionales solo para esta modalidad, además de las generales."
          : "Preguntas que responde toda persona que se inscribe, sin importar la modalidad."
      }
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {published ? (
            <AdminBadge icon={CircleCheck} tone="success">
              Publicado v{published.version}
            </AdminBadge>
          ) : (
            <AdminBadge icon={CircleDashed} tone="neutral">
              Sin versión publicada
            </AdminBadge>
          )}
          {draft ? (
            <AdminBadge icon={Pencil} tone="info">
              Borrador v{draft.version}
            </AdminBadge>
          ) : null}
        </div>
      }
    >
      <div className="flex flex-col gap-4" data-form-scope={scope.key}>
        {scope.modalityStatus === "CLOSED" ? <p className="text-caption text-ink-60">La modalidad está cerrada; su formulario se conserva.</p> : null}

        {published ? (
          <section aria-label={`Versión publicada de ${scope.name}`} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-body-sm font-bold text-ink">
                Versión publicada v{published.version}
                <span className="ml-2 text-caption font-normal text-ink-60">{formatDateTime(published.published_at, timezone)}</span>
              </h3>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="secondary" size="sm" aria-expanded={showPublishedPreview} onClick={() => setShowPublishedPreview((open) => !open)}>
                  {showPublishedPreview ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
                  {showPublishedPreview ? "Ocultar vista previa" : "Vista previa"}
                </Button>
                {draft ? null : (
                  <Button type="button" size="sm" loading={pending} disabled={frozen} onClick={() => void createDraft()}>
                    <Pencil className="size-4" aria-hidden="true" />
                    Editar (crea un borrador v{published.version + 1})
                  </Button>
                )}
              </div>
            </div>
            <p className="text-caption text-ink-60">
              Una versión publicada no se modifica: «Editar» crea un borrador y, al publicarlo, reemplaza a esta versión para las inscripciones nuevas.
            </p>
            <PublishedFields version={published} />
            {showPublishedPreview ? (
              <div className="rounded-control border border-divider p-3" role="region" aria-label={`Vista previa de la versión publicada de ${scope.name}`}>
                <FormPreview scope={`pub-${scope.key}`} fields={serverPreview(published)} />
              </div>
            ) : null}
          </section>
        ) : null}

        {draft ? (
          <DraftEditor
            // Keyed by the draft itself, never by its content: a refresh after saving must not remount the editor (it would close an open dialog).
            key={draft.registration_form_id}
            scope={scope}
            draft={draft}
            published={published}
            frozen={frozen}
          />
        ) : null}

        {nothing ? (
          <div className="flex flex-col items-start gap-2" data-testid="form-scope-empty">
            <p className="text-body-sm text-ink-80">
              {scope.modalityId
                ? "Esta modalidad usa el formulario general. Crea uno propio solo si necesita preguntas adicionales."
                : "Todavía no hay formulario. Se necesita una versión publicada para abrir inscripciones."}
            </p>
            <Button type="button" size="sm" loading={pending} disabled={frozen} onClick={() => void createDraft()}>
              <FilePlus2 className="size-4" aria-hidden="true" />
              Crear formulario
            </Button>
          </div>
        ) : null}

        {failure ? <RefusalNotice failure={failure} onRetry={() => void createDraft()} /> : null}

        {history.length > 0 ? (
          <details className="rounded-control border border-divider px-3 py-2">
            <summary className="flex cursor-pointer items-center gap-2 text-body-sm font-semibold text-ink">
              <History className="size-4" aria-hidden="true" />
              Versiones anteriores ({history.length})
            </summary>
            <ul className="mt-2 flex flex-col gap-3">
              {history.map((version) => (
                <li key={version.registration_form_id} className="text-body-sm">
                  <p className="font-semibold text-ink">
                    v{version.version} <span className="font-normal text-ink-60">· reemplazada · publicada {formatDateTime(version.published_at, timezone)}</span>
                  </p>
                  <PublishedFields version={version} />
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </Panel>
  );
}

function PublishedFields({ version }: { version: FormVersion }) {
  if (version.fields.length === 0) return <p className="text-body-sm text-ink-60">Sin preguntas extra.</p>;
  return (
    <ol className="flex flex-col divide-y divide-divider rounded-control border border-divider" aria-label={`Preguntas de la versión ${version.version}`}>
      {version.fields.map((field, index) => (
        <li key={field.field_key} className="flex flex-wrap items-baseline justify-between gap-x-4 px-3 py-2" data-field-key={field.field_key}>
          <span className="text-body-sm font-semibold text-ink">
            {index + 1}. {field.label}
          </span>
          <span className="text-caption text-ink-60">
            <span className="font-mono">{field.field_key}</span> · {describeFieldRules(field)}
          </span>
        </li>
      ))}
    </ol>
  );
}

function DraftEditor({ scope, draft, published, frozen }: { scope: FormScope; draft: FormVersion; published: FormVersion | null; frozen: boolean }) {
  const router = useRouter();
  const [fields, setFields] = React.useState<FieldDraft[]>(() => draft.fields.map(fieldDraftFromServer));
  const [savedSignature, setSavedSignature] = React.useState(() => fieldsSignature(draft.fields.map(fieldDraftFromServer)));
  const [errors, setErrors] = React.useState<Record<string, FieldDraftErrors>>({});
  const [failure, setFailure] = React.useState<ApiFailure | null>(null);
  const [pending, setPending] = React.useState(false);
  const [preview, setPreview] = React.useState(false);
  const [confirm, setConfirm] = React.useState<"publish" | "delete" | null>(null);

  const dirty = fieldsSignature(fields) !== savedSignature;
  const scopeId = `draft-${scope.key}`;

  function validate(): boolean {
    const found = validateFieldDrafts(fields);
    setErrors(found);
    const firstUid = fields.find((field) => found[field.uid])?.uid;
    if (firstUid) {
      document.getElementById(`${scopeId}-${firstUid}-label`)?.scrollIntoView({ block: "center" });
      const first = Object.keys(found[firstUid] ?? {})[0];
      const target = first === "field_key" ? `${scopeId}-${firstUid}-key` : `${scopeId}-${firstUid}-label`;
      document.getElementById(target)?.focus();
    }
    return !firstUid;
  }

  async function save() {
    if (pending || !validate()) return;
    setPending(true);
    setFailure(null);
    try {
      const result = await apiPut(`/api/v1/admin/forms/${draft.registration_form_id}/fields`, buildFieldsBody(fields));
      if (!result.ok) {
        setFailure(result);
        return;
      }
      setSavedSignature(fieldsSignature(fields));
      toast({ tone: "success", title: "Borrador guardado", description: "Aún no es lo que ve el público: publícalo cuando esté listo." });
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-label={`Borrador de ${scope.name}`} className="flex flex-col gap-3 rounded-control border border-info-border bg-paper-raised p-3" data-testid="form-draft">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-body-sm font-bold text-ink">
          Borrador v{draft.version}
          {published ? <span className="ml-2 text-caption font-normal text-ink-60">basado en v{published.version}</span> : null}
        </h3>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" size="sm" aria-expanded={preview} onClick={() => setPreview((open) => !open)}>
            {preview ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
            {preview ? "Ocultar vista previa" : "Vista previa"}
          </Button>
          <Button type="button" variant="secondary" size="sm" disabled={frozen || pending} onClick={() => setConfirm("delete")}>
            <Trash2 className="size-4" aria-hidden="true" />
            Eliminar borrador
          </Button>
        </div>
      </div>

      <FieldEditorList scope={scopeId} drafts={fields} errors={errors} onChange={(next) => { setFields(next); setErrors({}); }} />

      {preview ? (
        <div className="rounded-control border border-divider p-3" role="region" aria-label={`Vista previa del borrador de ${scope.name}`}>
          <FormPreview key={fieldsSignature(fields)} scope={`prev-${scope.key}`} fields={previewFields(fields)} />
        </div>
      ) : null}

      {failure ? <RefusalNotice failure={failure} onRetry={() => void save()} /> : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" loading={pending} disabled={frozen || !dirty} onClick={() => void save()}>
          <Save className="size-4" aria-hidden="true" />
          Guardar borrador
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={frozen || pending || dirty}
          aria-describedby={dirty ? `${scopeId}-publish-note` : undefined}
          onClick={() => {
            if (validate()) setConfirm("publish");
          }}
        >
          <Send className="size-4" aria-hidden="true" />
          Publicar v{draft.version}
        </Button>
        <p id={`${scopeId}-publish-note`} className="text-caption text-ink-60" role="status">
          {dirty ? "Hay cambios sin guardar: guarda el borrador antes de publicarlo." : "Guardado. Publicarlo lo hace visible en las inscripciones nuevas."}
        </p>
      </div>

      <ConfirmDialog
        open={confirm === "publish"}
        onOpenChange={(open) => setConfirm(open ? "publish" : null)}
        title={`Publicar la versión ${draft.version}`}
        description={
          published
            ? `La versión ${draft.version} reemplaza a la ${published.version} en las inscripciones nuevas. Las inscripciones ya hechas conservan las respuestas que dieron. No se puede editar después: para cambiarla se crea otro borrador.`
            : `La versión ${draft.version} será el formulario de las inscripciones nuevas. No se puede editar después: para cambiarla se crea otro borrador.`
        }
        confirmLabel="Publicar formulario"
        onConfirm={({ idempotencyKey }) =>
          apiFetch(`/api/v1/admin/forms/${draft.registration_form_id}/publish`, { method: "POST", body: {}, idempotencyKey })
        }
        onDone={() => {
          toast({ tone: "success", title: `Formulario v${draft.version} publicado` });
          router.refresh();
        }}
      />
      <ConfirmDialog
        open={confirm === "delete"}
        onOpenChange={(open) => setConfirm(open ? "delete" : null)}
        title={`Eliminar el borrador v${draft.version}`}
        description="Se descartan las preguntas de este borrador. La versión publicada no se toca."
        confirmLabel="Eliminar borrador"
        tone="danger"
        onConfirm={() => apiFetch(`/api/v1/admin/forms/${draft.registration_form_id}`, { method: "DELETE" })}
        onDone={() => {
          toast({ tone: "success", title: "Borrador eliminado" });
          router.refresh();
        }}
      />
    </section>
  );
}
