"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Archive, CircleCheck, CircleDashed, Pencil, Plus, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";
import { apiFetch, type ApiFailure, type ApiResult } from "@/lib/client/api";
import { Panel } from "@/components/admin/panel";
import { InputField, RefusalNotice, SelectField, TextareaField } from "@/components/admin/events/fields";
import { FormDialog } from "@/components/admin/events/form-dialog";
import { AdminBadge } from "@/components/admin/status-badges";
import { DeleteDialog } from "@/components/admin/edition-config/delete-dialog";
import {
  BLOCK_STATUS_LABEL,
  BLOCK_TYPE_LABEL,
  BLOCK_TYPE_OPTIONS,
  TONE_OPTIONS,
  buildContentBody,
  buildContentPatch,
  contentToDraft,
  emptyContentDraft,
  newItem,
  newSponsor,
  sortBlocks,
  summarizeBlock,
  validateContent,
  type BlockStatus,
  type BlockType,
  type CalloutTone,
  type ContentDraft,
  type ContentErrors,
  type ContentRow,
} from "@/components/admin/edition-config/content-logic";

type ModalityOption = { id: string; name: string };

const STATUS_BADGE: Record<BlockStatus, { icon: typeof CircleCheck; tone: "success" | "neutral" | "warning" }> = {
  PUBLISHED: { icon: CircleCheck, tone: "success" },
  DRAFT: { icon: CircleDashed, tone: "neutral" },
  ARCHIVED: { icon: Archive, tone: "warning" },
};

/** Blocks that make up the public page of the Edition (Master §51): text, notices, FAQ, links, sponsors and image REFERENCES. */
export function ContentManager({
  editionId,
  blocks,
  modalities,
  descriptionReady,
}: {
  editionId: string;
  blocks: readonly ContentRow[];
  modalities: readonly ModalityOption[];
  /** The server's DESCRIPTION_PRESENT readiness check (not recomputed here). */
  descriptionReady: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = React.useState<ContentRow | "new" | null>(null);
  const [removing, setRemoving] = React.useState<ContentRow | null>(null);
  const [failure, setFailure] = React.useState<{ block: string; error: ApiFailure } | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const modalityName = new Map(modalities.map((entry) => [entry.id, entry.name]));
  const ordered = sortBlocks(blocks);

  async function setStatus(block: ContentRow, status: BlockStatus) {
    if (busy) return;
    setBusy(block.event_content_block_id);
    setFailure(null);
    try {
      const result = await apiFetch(`/api/v1/admin/content-blocks/${block.event_content_block_id}`, { method: "PATCH", body: { status } });
      if (!result.ok) {
        setFailure({ block: block.event_content_block_id, error: result });
        return;
      }
      toast({ tone: "success", title: status === "PUBLISHED" ? "Bloque publicado" : "Bloque archivado" });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p
        className={`rounded-control border px-3 py-2 text-body-sm text-ink ${descriptionReady ? "border-success-border bg-success-tint" : "border-warning-border bg-warning-tint"}`}
        role="note"
        data-testid="description-note"
      >
        {descriptionReady
          ? "La descripción mínima ya está publicada (el servidor la reconoce)."
          : "Falta la descripción mínima: publica un bloque de Texto o de Sección con título con al menos 30 caracteres. Es un requisito para publicar la edición."}
      </p>

      <Panel
        title="Bloques de contenido"
        description="Se muestran en la página pública en este orden. Solo los publicados son visibles; el texto es Markdown simple, sin HTML."
        actions={
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus className="size-4" aria-hidden="true" />
            Agregar bloque
          </Button>
        }
      >
        {ordered.length === 0 ? (
          <p className="text-body-sm text-ink-60" data-testid="content-empty">
            Sin bloques todavía. Empieza con un bloque de Texto: la descripción de la carrera.
          </p>
        ) : (
          <ul className="divide-y divide-divider">
            {ordered.map((block) => {
              const badge = STATUS_BADGE[block.status];
              return (
                <li key={block.event_content_block_id} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0" data-block-type={block.block_type}>
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-body-sm font-semibold text-ink">
                      {BLOCK_TYPE_LABEL[block.block_type] ?? block.block_type}
                      <AdminBadge icon={badge.icon} tone={badge.tone}>
                        {BLOCK_STATUS_LABEL[block.status]}
                      </AdminBadge>
                      <span className="text-caption font-normal text-ink-60">
                        Posición {block.position}
                        {block.modality_id ? ` · Solo ${modalityName.get(block.modality_id) ?? "una modalidad"}` : ""}
                      </span>
                    </p>
                    <p className="text-body-sm text-ink-80">{summarizeBlock(block)}</p>
                    {failure && failure.block === block.event_content_block_id ? <RefusalNotice className="mt-2" failure={failure.error} /> : null}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {block.status !== "PUBLISHED" ? (
                      <Button variant="secondary" size="sm" loading={busy === block.event_content_block_id} onClick={() => void setStatus(block, "PUBLISHED")}>
                        <Send className="size-4" aria-hidden="true" />
                        Publicar<span className="sr-only"> el bloque {summarizeBlock(block)}</span>
                      </Button>
                    ) : (
                      <Button variant="secondary" size="sm" loading={busy === block.event_content_block_id} onClick={() => void setStatus(block, "ARCHIVED")}>
                        <Archive className="size-4" aria-hidden="true" />
                        Archivar<span className="sr-only"> el bloque {summarizeBlock(block)}</span>
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => setEditing(block)}>
                      <Pencil className="size-4" aria-hidden="true" />
                      Editar<span className="sr-only"> el bloque {summarizeBlock(block)}</span>
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setRemoving(block)}>
                      <Trash2 className="size-4" aria-hidden="true" />
                      Eliminar<span className="sr-only"> el bloque {summarizeBlock(block)}</span>
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel title="Imágenes y medios" description="Referencias a recursos multimedia de la edición.">
        <p className="text-body-sm text-ink-80" data-testid="media-note">
          Todavía no se pueden cargar imágenes desde el panel: no existe una función de carga ni un catálogo de recursos. Los bloques de Imagen, Galería y Patrocinadores
          guardan la <strong>referencia</strong> (identificador) de un recurso que ya exista para esta edición; mientras no haya imagen principal, el sitio usa la imagen
          predeterminada de la plataforma y eso no bloquea la publicación.
        </p>
      </Panel>

      {editing ? (
        <ContentDialog
          key={editing === "new" ? "new" : editing.event_content_block_id}
          editionId={editionId}
          block={editing === "new" ? null : editing}
          modalities={modalities}
          onClose={() => setEditing(null)}
        />
      ) : null}

      {removing ? (
        <DeleteDialog
          title="Eliminar el bloque"
          description={`Se elimina «${summarizeBlock(removing)}». Si solo quieres dejar de mostrarlo, archívalo.`}
          endpoint={`/api/v1/admin/content-blocks/${removing.event_content_block_id}`}
          confirmLabel="Eliminar bloque"
          successMessage="Bloque eliminado"
          onClose={() => setRemoving(null)}
        />
      ) : null}
    </div>
  );
}

function ContentDialog({
  editionId,
  block,
  modalities,
  onClose,
}: {
  editionId: string;
  block: ContentRow | null;
  modalities: readonly ModalityOption[];
  onClose: () => void;
}) {
  const initial = React.useMemo(() => (block ? contentToDraft(block) : emptyContentDraft()), [block]);
  const [draft, setDraft] = React.useState<ContentDraft>(initial);
  const [errors, setErrors] = React.useState<ContentErrors>({});
  const set = (patch: Partial<ContentDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setErrors({});
  };
  const typeHint = BLOCK_TYPE_OPTIONS.find((option) => option.value === draft.block_type)?.hint;

  async function onSubmit(): Promise<ApiResult<unknown> | null> {
    const next = validateContent(draft);
    setErrors(next);
    if (Object.values(next).some(Boolean)) return null;
    if (block) {
      const patch = buildContentPatch(initial, draft);
      if (!patch) {
        setErrors({ form: "No hay cambios que guardar." });
        return null;
      }
      return apiFetch(`/api/v1/admin/content-blocks/${block.event_content_block_id}`, { method: "PATCH", body: patch });
    }
    return apiFetch(`/api/v1/admin/editions/${editionId}/content-blocks`, { method: "POST", body: buildContentBody(draft) });
  }

  const type = draft.block_type;
  return (
    <FormDialog
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={block ? `Editar ${BLOCK_TYPE_LABEL[block.block_type] ?? "bloque"}` : "Agregar bloque de contenido"}
      description={typeHint}
      submitLabel={block ? "Guardar bloque" : "Agregar bloque"}
      successMessage={block ? "Bloque actualizado" : "Bloque agregado"}
      onSubmit={onSubmit}
      widthClassName="max-w-2xl"
    >
      {errors.form ? (
        <p className="text-body-sm text-danger" role="alert">
          {errors.form}
        </p>
      ) : null}
      <div className="grid gap-x-4 sm:grid-cols-2">
        {block ? null : (
          <SelectField
            id="content-type"
            name="block_type"
            label="Tipo de bloque"
            required
            value={type}
            options={BLOCK_TYPE_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
            onChange={(event) => {
              const next = event.target.value as BlockType;
              set({
                block_type: next,
                items: next === "FAQ" || next === "GALLERY" ? [newItem()] : [],
                sponsors: next === "SPONSOR_GROUP" ? [newSponsor()] : [],
              });
            }}
          />
        )}
        <SelectField
          id="content-status"
          name="status"
          label="Estado"
          value={draft.status}
          helperText="Solo un bloque publicado se ve en el sitio."
          options={(Object.keys(BLOCK_STATUS_LABEL) as BlockStatus[]).map((status) => ({ value: status, label: BLOCK_STATUS_LABEL[status] }))}
          onChange={(event) => set({ status: event.target.value as BlockStatus })}
        />
        <InputField id="content-position" name="position" label="Posición" inputMode="numeric" value={draft.position} error={errors.position} helperText="Vacío: al final." autoComplete="off" onChange={(event) => set({ position: event.target.value })} />
        <SelectField
          id="content-modality"
          name="modality_id"
          label="Aparece en"
          value={draft.modality_id}
          options={[{ value: "", label: "Toda la edición" }, ...modalities.map((entry) => ({ value: entry.id, label: `Solo ${entry.name}` }))]}
          onChange={(event) => set({ modality_id: event.target.value })}
        />
      </div>

      {type === "RICH_TEXT" || type === "CUSTOM_SECTION" || type === "CALLOUT" || type === "FAQ" || type === "GALLERY" || type === "SPONSOR_GROUP" ? (
        <InputField
          id="content-title"
          name="title"
          label={type === "CUSTOM_SECTION" ? "Título de la sección" : "Título (opcional)"}
          required={type === "CUSTOM_SECTION"}
          value={draft.title}
          error={errors.title}
          maxLength={160}
          autoComplete="off"
          onChange={(event) => set({ title: event.target.value })}
        />
      ) : null}

      {type === "CALLOUT" ? (
        <SelectField id="content-tone" name="tone" label="Tipo de aviso" value={draft.tone} options={TONE_OPTIONS} onChange={(event) => set({ tone: event.target.value as CalloutTone })} />
      ) : null}

      {type === "RICH_TEXT" || type === "CUSTOM_SECTION" || type === "CALLOUT" ? (
        <TextareaField
          id="content-markdown"
          name="markdown"
          label="Texto (Markdown)"
          required
          rows={type === "CALLOUT" ? 4 : 8}
          value={draft.markdown}
          error={errors.markdown}
          helperText="Párrafos, **negritas**, listas y enlaces [texto](https://…). Sin HTML ni imágenes dentro del texto."
          onChange={(event) => set({ markdown: event.target.value })}
        />
      ) : null}

      {type === "IMAGE" ? (
        <div className="grid gap-x-4 sm:grid-cols-2">
          <InputField id="content-media" name="media_id" label="Referencia del recurso multimedia" required value={draft.media_id} error={errors.media_id} helperText="Identificador (UUID) de una imagen ya cargada para esta edición." autoComplete="off" spellCheck={false} onChange={(event) => set({ media_id: event.target.value })} />
          <InputField id="content-caption" name="caption" label="Leyenda (opcional)" value={draft.caption} error={errors.caption} maxLength={300} autoComplete="off" onChange={(event) => set({ caption: event.target.value })} />
        </div>
      ) : null}

      {type === "DOCUMENT_LINK" ? (
        <div className="grid gap-x-4 sm:grid-cols-2">
          <InputField id="content-label" name="label" label="Etiqueta del enlace" required value={draft.label} error={errors.label} maxLength={160} autoComplete="off" onChange={(event) => set({ label: event.target.value })} />
          <InputField id="content-url" name="url" label="Dirección (URL)" required value={draft.url} error={errors.url} helperText="https://…, mailto:, tel: o una ruta del sitio (/…)." autoComplete="off" spellCheck={false} onChange={(event) => set({ url: event.target.value })} />
          <TextareaField id="content-description" name="description" label="Descripción (opcional)" value={draft.description} error={errors.description} maxLength={300} className="sm:col-span-2" onChange={(event) => set({ description: event.target.value })} />
        </div>
      ) : null}

      {type === "FAQ" ? (
        <fieldset className="rounded-control border border-divider px-3 pb-2 pt-1">
          <legend className="px-1 text-label font-semibold text-ink">Preguntas</legend>
          {errors.items ? (
            <p className="text-caption text-danger" role="alert">
              {errors.items}
            </p>
          ) : null}
          <ul className="flex flex-col gap-3">
            {draft.items.map((item, index) => (
              <li key={item.uid} className="rounded-control border border-divider p-2">
                <InputField id={`faq-q-${item.uid}`} name={`question-${index}`} label={`Pregunta ${index + 1}`} required value={item.question} error={errors[`item:${item.uid}:question`]} maxLength={300} autoComplete="off" onChange={(event) => set({ items: draft.items.map((entry) => (entry.uid === item.uid ? { ...entry, question: event.target.value } : entry)) })} />
                <TextareaField id={`faq-a-${item.uid}`} name={`answer-${index}`} label={`Respuesta ${index + 1} (Markdown)`} required value={item.answer} error={errors[`item:${item.uid}:answer`]} onChange={(event) => set({ items: draft.items.map((entry) => (entry.uid === item.uid ? { ...entry, answer: event.target.value } : entry)) })} />
                <Button type="button" variant="ghost" size="sm" onClick={() => set({ items: draft.items.filter((entry) => entry.uid !== item.uid) })}>
                  <Trash2 className="size-4" aria-hidden="true" />
                  Quitar la pregunta {index + 1}
                </Button>
              </li>
            ))}
          </ul>
          <Button type="button" variant="secondary" size="sm" disabled={draft.items.length >= 50} onClick={() => set({ items: [...draft.items, newItem()] })}>
            <Plus className="size-4" aria-hidden="true" />
            Agregar pregunta
          </Button>
        </fieldset>
      ) : null}

      {type === "GALLERY" ? (
        <fieldset className="rounded-control border border-divider px-3 pb-2 pt-1">
          <legend className="px-1 text-label font-semibold text-ink">Imágenes (referencias)</legend>
          {errors.items ? (
            <p className="text-caption text-danger" role="alert">
              {errors.items}
            </p>
          ) : null}
          <ul className="flex flex-col gap-2">
            {draft.items.map((item, index) => (
              <li key={item.uid} className="grid items-start gap-x-3 sm:grid-cols-[1fr_1fr_auto]">
                <InputField id={`gal-m-${item.uid}`} name={`media-${index}`} label={`Referencia de la imagen ${index + 1}`} required value={item.media_id} error={errors[`item:${item.uid}:media_id`]} autoComplete="off" spellCheck={false} onChange={(event) => set({ items: draft.items.map((entry) => (entry.uid === item.uid ? { ...entry, media_id: event.target.value } : entry)) })} />
                <InputField id={`gal-c-${item.uid}`} name={`caption-${index}`} label={`Leyenda ${index + 1}`} value={item.caption} error={errors[`item:${item.uid}:caption`]} maxLength={300} autoComplete="off" onChange={(event) => set({ items: draft.items.map((entry) => (entry.uid === item.uid ? { ...entry, caption: event.target.value } : entry)) })} />
                <div className="pt-6">
                  <Button type="button" variant="ghost" size="sm" onClick={() => set({ items: draft.items.filter((entry) => entry.uid !== item.uid) })}>
                    <Trash2 className="size-4" aria-hidden="true" />
                    <span className="sr-only">Quitar la imagen {index + 1}</span>
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          <Button type="button" variant="secondary" size="sm" disabled={draft.items.length >= 30} onClick={() => set({ items: [...draft.items, newItem()] })}>
            <Plus className="size-4" aria-hidden="true" />
            Agregar imagen
          </Button>
        </fieldset>
      ) : null}

      {type === "SPONSOR_GROUP" ? (
        <fieldset className="rounded-control border border-divider px-3 pb-2 pt-1">
          <legend className="px-1 text-label font-semibold text-ink">Patrocinadores</legend>
          {errors.sponsors ? (
            <p className="text-caption text-danger" role="alert">
              {errors.sponsors}
            </p>
          ) : null}
          <ul className="flex flex-col gap-2">
            {draft.sponsors.map((sponsor, index) => (
              <li key={sponsor.uid} className="grid items-start gap-x-3 sm:grid-cols-3">
                <InputField id={`sp-n-${sponsor.uid}`} name={`sponsor_name-${index}`} label={`Nombre ${index + 1}`} required value={sponsor.name} error={errors[`sponsor:${sponsor.uid}:name`]} maxLength={120} autoComplete="off" onChange={(event) => set({ sponsors: draft.sponsors.map((entry) => (entry.uid === sponsor.uid ? { ...entry, name: event.target.value } : entry)) })} />
                <InputField id={`sp-u-${sponsor.uid}`} name={`sponsor_url-${index}`} label={`Enlace ${index + 1} (https)`} value={sponsor.url} error={errors[`sponsor:${sponsor.uid}:url`]} autoComplete="off" spellCheck={false} onChange={(event) => set({ sponsors: draft.sponsors.map((entry) => (entry.uid === sponsor.uid ? { ...entry, url: event.target.value } : entry)) })} />
                <InputField id={`sp-m-${sponsor.uid}`} name={`sponsor_media-${index}`} label={`Logo ${index + 1} (referencia)`} value={sponsor.media_id} error={errors[`sponsor:${sponsor.uid}:media_id`]} autoComplete="off" spellCheck={false} onChange={(event) => set({ sponsors: draft.sponsors.map((entry) => (entry.uid === sponsor.uid ? { ...entry, media_id: event.target.value } : entry)) })} />
                <Button type="button" variant="ghost" size="sm" className="justify-self-start" onClick={() => set({ sponsors: draft.sponsors.filter((entry) => entry.uid !== sponsor.uid) })}>
                  <Trash2 className="size-4" aria-hidden="true" />
                  Quitar el patrocinador {index + 1}
                </Button>
              </li>
            ))}
          </ul>
          <Button type="button" variant="secondary" size="sm" disabled={draft.sponsors.length >= 50} onClick={() => set({ sponsors: [...draft.sponsors, newSponsor()] })}>
            <Plus className="size-4" aria-hidden="true" />
            Agregar patrocinador
          </Button>
        </fieldset>
      ) : null}
    </FormDialog>
  );
}
