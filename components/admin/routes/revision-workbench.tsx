"use client";

import React from "react";
import { usePathname, useRouter } from "next/navigation";
import { CircleCheck, Copy, FileCheck2, Save, ShieldCheck } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";
import { newIdempotencyKey, toApiResult, type ApiFailure, type ApiResult } from "@/lib/client/api";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { RefusalNotice } from "@/components/admin/events/fields";
import { UnsavedChangesGuard } from "@/components/admin/events/unsaved-guard";
import { formatDateTime } from "@/components/admin/format";
import { Panel } from "@/components/admin/panel";
import { RevisionStatusBadge, SOURCE_LABEL } from "@/components/admin/routes/revision-badges";
import { createRevision, publishRevision, saveRevision, validateRevision } from "@/components/admin/routes/route-api";
import { editorReducer, initialEditorState, isDirty, type Snapshot } from "@/components/admin/routes/route-editor-state";
import type { MapTool } from "@/components/admin/routes/route-editor-canvas";
import { RouteEditorMap } from "@/components/admin/routes/route-editor-map";
import {
  POI_TYPE_LABEL,
  REVISION_BODY_LIMIT_BYTES,
  bodyBytes,
  draftProblems,
  formatBytes,
  formatKm,
  geometryInput,
  hasProblems,
  midpoint,
  newPoiKey,
  orderPois,
  parseValidation,
  pathLengthM,
  poiFromServer,
  poiToInput,
  sameCoords,
  simplifyUntilFits,
  type LonLat,
  type ModalityOption,
  type PoiType,
  type RevisionFull,
  type RevisionSummary,
  type RouteDetail,
  type ValidationResult,
} from "@/components/admin/routes/route-geometry";
import { RouteSummary } from "@/components/admin/routes/route-summary";
import { RouteToolbar, TOOL_HELP } from "@/components/admin/routes/route-toolbar";
import { PoiPanel } from "@/components/admin/routes/poi-panel";
import { ValidationPanel } from "@/components/admin/routes/validation-panel";
import { VertexPanel } from "@/components/admin/routes/vertex-panel";

const WIDE_QUERY = "(min-width: 768px)";

/** True from tablet width up. Route editing is desktop/tablet first (UX mobile-limited rule); the server render and the first client render say false. */
function useWideViewport(): boolean {
  return React.useSyncExternalStore(
    (notify) => {
      const query = window.matchMedia(WIDE_QUERY);
      query.addEventListener("change", notify);
      return () => query.removeEventListener("change", notify);
    },
    () => window.matchMedia(WIDE_QUERY).matches,
    () => false,
  );
}

function snapshotOf(revision: RevisionFull | null): Snapshot {
  return {
    coords: revision ? (revision.geometry.coordinates as LonLat[]) : [],
    pois: revision ? orderPois(revision.pois.map(poiFromServer)) : [],
  };
}

type Oversize = { bytes: number; action: "save" | "copy"; hopeless?: boolean };

/**
 * One revision of one Route (P3-F): the map, the toolbar, the text alternatives, validation and the publish decision.
 *
 * Contract with the server (Master §46-§50, P3-AC-07):
 *  - a PUBLISHED or SUPERSEDED revision is immutable; the only way to change it is to create a new DRAFT from it (POST /revisions);
 *  - a DRAFT is edited locally (undo/redo) and saved explicitly; nothing is shown as saved until the API answered ok, and what the
 *    API answered replaces the working copy;
 *  - saving resets the validation, validating is a server command, and publishing needs a validation without errors (the server checks
 *    again); the UI never computes a verdict;
 *  - `computed_distance_m` (server) and `official_distance_m` (modality) are separate from the live on-screen distance and are never overwritten.
 * `revision === null` is a Route with no revisions yet: the operator draws one from scratch and the first save creates it.
 */
export function RevisionWorkbench({
  route,
  revision,
  revisions,
  modalities,
  timeZone,
}: {
  route: RouteDetail;
  revision: RevisionFull | null;
  revisions: readonly RevisionSummary[];
  modalities: readonly ModalityOption[];
  timeZone: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const wide = useWideViewport();

  const [serverRevision, setServerRevision] = React.useState<RevisionFull | null>(revision);
  const [editor, dispatch] = React.useReducer(editorReducer, revision, (initial) => initialEditorState(snapshotOf(initial)));
  const [tool, setTool] = React.useState<MapTool>("view");
  const [poiType, setPoiType] = React.useState<PoiType>("HYDRATION");
  const [preview, setPreview] = React.useState(false);
  const [fitSignal, setFitSignal] = React.useState(0);
  const [focus, setFocus] = React.useState<{ signal: number; index: number | null }>({ signal: 0, index: null });
  const [busy, setBusy] = React.useState<null | "save" | "validate" | "copy">(null);
  const [failure, setFailure] = React.useState<ApiFailure | null>(null);
  const [failureKind, setFailureKind] = React.useState<"save" | "validate" | "copy">("save");
  const [problems, setProblems] = React.useState<ReturnType<typeof draftProblems> | null>(null);
  const [oversize, setOversize] = React.useState<Oversize | null>(null);
  const [confirmingPublish, setConfirmingPublish] = React.useState(false);
  const [confirmingCopy, setConfirmingCopy] = React.useState<{ coords: LonLat[]; toleranceM: number } | null>(null);
  const [liveMessage, setLiveMessage] = React.useState("");
  // One key per "create the first revision" intent: a retry after a failure cannot create two.
  const createKeyRef = React.useRef<string | null>(null);

  const { coords, pois } = editor.present;
  const dirty = isDirty(editor);
  const isNew = serverRevision === null;
  const editable = isNew || serverRevision.status === "DRAFT";
  const canEditMap = editable && wide && !preview;
  const computedM = React.useMemo(() => pathLengthM(coords), [coords]);
  const validation: ValidationResult | null = React.useMemo(() => parseValidation(serverRevision?.validation_result), [serverRevision]);
  const modalityById = React.useMemo(() => new Map(modalities.map((modality) => [modality.modality_id, modality])), [modalities]);
  const routeModalities = React.useMemo(() => route.modality_ids.map((id) => modalityById.get(id)).filter((m): m is ModalityOption => Boolean(m)), [route.modality_ids, modalityById]);
  const modalityName = React.useCallback((id: string) => modalityById.get(id)?.name ?? null, [modalityById]);
  const activeRevision = revisions.find((entry) => entry.route_revision_id === route.active_revision_id) ?? null;
  const problemsNow = problems ?? { geometry: null, pois: {} };

  // ---- editing actions (local until saved)
  const add = (point: LonLat) => dispatch({ type: "add_vertex", point });
  const insert = (index: number, point: LonLat) => dispatch({ type: "insert_vertex", index, point });
  const move = (index: number, point: LonLat) => dispatch({ type: "move_vertex", index, point });
  const remove = (index: number) => dispatch({ type: "delete_vertex", index });
  const setEdge = (kind: "START" | "FINISH", point: LonLat) =>
    dispatch({
      type: "set_edge_poi",
      poi_type: kind,
      key: pois.find((poi) => poi.poi_type === kind)?.key ?? newPoiKey(),
      point,
      name: POI_TYPE_LABEL[kind],
    });
  const place = (kind: "start" | "finish" | "poi", point: LonLat) => {
    if (kind === "start") setEdge("START", point);
    else if (kind === "finish") setEdge("FINISH", point);
    else
      dispatch({
        type: "add_poi",
        poi: { key: newPoiKey(), poi_type: poiType, name: POI_TYPE_LABEL[poiType], description: "", longitude: point[0], latitude: point[1] },
      });
  };
  const centerOn = (index: number) => setFocus((current) => ({ signal: current.signal + 1, index }));

  function onKeyDown(event: React.KeyboardEvent) {
    if (!editable || !(event.ctrlKey || event.metaKey)) return;
    const target = event.target as HTMLElement;
    if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
    const key = event.key.toLowerCase();
    if (key === "z" && !event.shiftKey) dispatch({ type: "undo" });
    else if (key === "y" || (key === "z" && event.shiftKey)) dispatch({ type: "redo" });
    else return;
    event.preventDefault();
  }

  // ---- server commands
  function adopt(next: RevisionFull) {
    setServerRevision(next);
    dispatch({ type: "saved", snapshot: snapshotOf(next) });
    setProblems(null);
    setOversize(null);
  }

  async function save() {
    setFailure(null);
    const found = draftProblems(coords, pois);
    setProblems(found);
    if (hasProblems(found)) return;

    const geometryChanged = isNew || !sameCoords(coords as LonLat[], serverRevision.geometry.coordinates as LonLat[]);
    const body: { geometry?: ReturnType<typeof geometryInput>; pois: ReturnType<typeof poiToInput>[] } = { pois: orderPois(pois).map(poiToInput) };
    if (geometryChanged) body.geometry = geometryInput(coords);
    // PATCH and POST /revisions still use the API's default 64 KiB body limit: say so before sending something it is sure to refuse.
    const bytes = bodyBytes(body);
    if (bytes > REVISION_BODY_LIMIT_BYTES) {
      setOversize({ bytes, action: "save" });
      return;
    }

    setBusy("save");
    try {
      let result: ApiResult<RevisionFull>;
      if (isNew) {
        createKeyRef.current ??= newIdempotencyKey();
        result = await createRevision(route.route_id, body, createKeyRef.current);
      } else {
        result = await saveRevision(serverRevision.route_revision_id, body);
      }
      if (!result.ok) {
        setFailure(result);
        setFailureKind("save");
        return;
      }
      toast({ tone: "success", title: isNew ? "Revisión creada como borrador" : "Borrador guardado" });
      if (isNew) {
        createKeyRef.current = null;
        router.push(`${pathname}?route=${route.route_id}&revision=${result.data.route_revision_id}`);
        return;
      }
      adopt(result.data);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function validate() {
    if (!serverRevision) return;
    setFailure(null);
    setBusy("validate");
    try {
      const result = await validateRevision(serverRevision.route_revision_id);
      if (!result.ok) {
        setFailure(result);
        setFailureKind("validate");
        return;
      }
      setServerRevision({ ...serverRevision, validation_result: result.data as unknown as Record<string, unknown> });
      setLiveMessage(
        result.data.errors.length > 0
          ? `Validación terminada: ${result.data.errors.length} errores que impiden publicar.`
          : `Validación terminada sin errores y con ${result.data.warnings.length} advertencias.`,
      );
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function copyAsDraft(source: { coords: LonLat[] }) {
    if (!serverRevision) return;
    setFailure(null);
    setBusy("copy");
    try {
      const body = { geometry: geometryInput(source.coords), pois: orderPois(serverRevision.pois.map(poiFromServer)).map(poiToInput) };
      const result = await createRevision(route.route_id, body, newIdempotencyKey());
      if (!result.ok) {
        setFailure(result);
        setFailureKind("copy");
        return;
      }
      toast({ tone: "success", title: "Borrador creado a partir de la revisión" });
      router.push(`${pathname}?route=${route.route_id}&revision=${result.data.route_revision_id}`);
    } finally {
      setBusy(null);
    }
  }

  function startCopy() {
    if (!serverRevision) return;
    setFailure(null);
    const original = serverRevision.geometry.coordinates as LonLat[];
    const pois = orderPois(serverRevision.pois.map(poiFromServer)).map(poiToInput);
    const fits = (candidate: LonLat[]) => bodyBytes({ geometry: geometryInput(candidate), pois }) <= REVISION_BODY_LIMIT_BYTES;
    if (fits(original)) {
      void copyAsDraft({ coords: original });
      return;
    }
    const simplified = simplifyUntilFits(original, fits);
    if (!simplified) {
      setOversize({ bytes: bodyBytes({ geometry: geometryInput(original), pois }), action: "copy" });
      return;
    }
    setConfirmingCopy(simplified);
  }

  function simplifyForSave() {
    const pending = orderPois(pois).map(poiToInput);
    const fits = (candidate: LonLat[]) => bodyBytes({ geometry: geometryInput(candidate), pois: pending }) <= REVISION_BODY_LIMIT_BYTES;
    const simplified = simplifyUntilFits(coords, fits);
    if (!simplified) {
      setOversize((current) => (current ? { ...current, hopeless: true } : current));
      return;
    }
    dispatch({ type: "replace_geometry", coords: simplified.coords });
    setOversize(null);
    setLiveMessage(`Ruta simplificada a ${simplified.coords.length} puntos (tolerancia ${simplified.toleranceM} m). Revisa el resultado y guarda.`);
  }

  const publishBlocked = !editable || isNew ? null : dirty ? "Guarda los cambios antes de publicar." : !validation ? "Valida la revisión antes de publicar." : !validation.valid ? "Resuelve los errores de la validación antes de publicar." : null;

  const meta = serverRevision;
  return (
    <div className="flex flex-col gap-4" onKeyDown={onKeyDown} data-testid="revision-workbench" data-revision-status={serverRevision?.status ?? "NEW"} data-dirty={dirty ? "true" : "false"}>
      <UnsavedChangesGuard dirty={dirty} />

      <Panel
        title={isNew ? "Nueva revisión (sin guardar)" : `Revisión ${meta?.revision}`}
        description={
          isNew
            ? "Dibuja el recorrido y guárdalo: se crea como borrador."
            : meta?.status === "DRAFT"
              ? "Borrador: se edita y se guarda; no se ve en el sitio hasta publicarlo."
              : "Esta revisión ya no se puede editar. Para cambiarla se crea una revisión nueva a partir de ella."
        }
        actions={
          editable ? (
            <>
              <Button type="button" variant="secondary" loading={busy === "save"} disabled={busy !== null || (!dirty && !isNew) || (isNew && coords.length === 0)} onClick={() => void save()}>
                <Save className="size-4" aria-hidden="true" />
                {isNew ? "Crear borrador" : "Guardar borrador"}
              </Button>
              <Button type="button" variant="secondary" loading={busy === "validate"} disabled={busy !== null || isNew || dirty} onClick={() => void validate()} title={dirty ? "Guarda el borrador primero: se valida lo guardado" : undefined}>
                <ShieldCheck className="size-4" aria-hidden="true" />
                Validar
              </Button>
              <Button type="button" disabled={busy !== null || isNew || publishBlocked !== null} onClick={() => setConfirmingPublish(true)} title={publishBlocked ?? undefined}>
                <FileCheck2 className="size-4" aria-hidden="true" />
                Publicar revisión
              </Button>
            </>
          ) : (
            <Button type="button" variant="secondary" loading={busy === "copy"} disabled={busy !== null} onClick={startCopy}>
              <Copy className="size-4" aria-hidden="true" />
              Crear borrador a partir de esta revisión
            </Button>
          )
        }
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {meta ? <RevisionStatusBadge value={meta.status} /> : null}
            <span className="text-body-sm text-ink-80" data-testid="revision-source">
              {meta ? `${SOURCE_LABEL[meta.source]}${meta.source_filename ? `: ${meta.source_filename}` : ""}` : "Dibujada a mano"}
            </span>
            {dirty ? (
              <span className="text-body-sm font-semibold text-warning" data-testid="dirty-note">
                Cambios sin guardar
              </span>
            ) : null}
          </div>
          {meta ? (
            <p className="text-caption text-ink-60" data-testid="revision-meta">
              Creada el {formatDateTime(meta.created_at, timeZone)}
              {meta.created_by_staff_label ? ` por ${meta.created_by_staff_label}` : ""}
              {meta.published_at ? ` · publicada el ${formatDateTime(meta.published_at, timeZone)}` : ""}
              {meta.superseded_at ? ` · reemplazada el ${formatDateTime(meta.superseded_at, timeZone)}` : ""}
            </p>
          ) : null}
          {editable && publishBlocked ? (
            <p className="text-caption text-ink-60" data-testid="publish-blocked">
              Publicar: {publishBlocked}
            </p>
          ) : null}
          {!editable ? (
            <p className="rounded-control border border-info-border bg-info-tint px-3 py-2 text-body-sm text-ink" role="note" data-testid="immutable-note">
              Una revisión publicada es inmutable: lo que ve el público no cambia por accidente. Edita creando un borrador nuevo y publícalo cuando esté listo.
            </p>
          ) : null}
        </div>
      </Panel>

      {failure ? <RefusalNotice
          failure={failure}
          onRetry={() => {
            if (failureKind === "save") void save();
            else if (failureKind === "validate") void validate();
            else startCopy();
          }}
        /> : null}

      {oversize ? (
        <Alert
          tone="warning"
          title={oversize.action === "copy" ? "La ruta es demasiado grande para copiarla" : "La ruta es demasiado grande para guardarla desde el editor"}
          action={
            oversize.action === "save" && coords.length > 2 && !oversize.hopeless ? (
              <Button type="button" size="sm" variant="secondary" onClick={simplifyForSave}>
                Simplificar la ruta para poder guardarla
              </Button>
            ) : undefined
          }
        >
          <span data-testid="oversize-note">
            El envío pesa {formatBytes(oversize.bytes)} y el servidor acepta hasta {formatBytes(REVISION_BODY_LIMIT_BYTES)} por guardado en este paso. Los cambios de puntos de interés pesan poco; el recorrido
            de {coords.length.toLocaleString("es-MX")} puntos, no.{" "}
            {oversize.hopeless
              ? "Ni simplificándolo cabe en un guardado: importa un GPX con menos puntos."
              : "Puedes simplificar el trazo (se quitan puntos casi alineados; verás el resultado y podrás deshacerlo antes de guardar) o importar un GPX con menos puntos."}
          </span>
        </Alert>
      ) : null}

      {editable && !wide ? (
        <p className="rounded-control border border-info-border bg-info-tint px-3 py-2 text-body-sm text-ink" role="note" data-testid="mobile-note">
          El trazo se edita desde una tablet o una computadora. Aquí puedes ver el mapa, el resumen y la validación, y guardar, validar o publicar lo que ya está listo.
        </p>
      ) : null}

      {editable && wide ? (
        <RouteToolbar
          tool={tool}
          onTool={setTool}
          canUndo={editor.past.length > 0}
          canRedo={editor.future.length > 0}
          onUndo={() => dispatch({ type: "undo" })}
          onRedo={() => dispatch({ type: "redo" })}
          onFit={() => setFitSignal((current) => current + 1)}
          onCalculate={() => setLiveMessage(`Distancia calculada en pantalla: ${formatKm(computedM)} con ${coords.length} puntos.`)}
          computedM={computedM}
          poiType={poiType}
          onPoiType={setPoiType}
          preview={preview}
          onPreview={() => {
            setPreview((current) => !current);
            setTool("view");
          }}
          errorCount={validation?.errors.length ?? 0}
          warningCount={validation?.warnings.length ?? 0}
          validated={validation !== null}
        />
      ) : null}
      <p className="sr-only" role="status" data-testid="live-message">
        {liveMessage}
      </p>
      {canEditMap ? (
        <p className="text-body-sm text-ink-80" aria-live="polite" data-testid="tool-hint">
          {TOOL_HELP[tool]}
        </p>
      ) : null}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex flex-col gap-2">
          <RouteEditorMap
            label={`Mapa de la ruta ${route.name}, revisión ${meta?.revision ?? "nueva"}`}
            coords={coords}
            pois={pois}
            selected={editor.selected}
            tool={tool}
            editable={canEditMap}
            showVertices={!preview}
            fitSignal={fitSignal}
            focusSignal={focus.signal}
            focusIndex={focus.index}
            vertexCount={coords.length}
            onAdd={add}
            onInsert={insert}
            onMove={move}
            onDelete={remove}
            onSelect={(index) => dispatch({ type: "select", index })}
            onPlace={place}
          />
          <p className="text-caption text-ink-60">
            El mapa dibuja la ruta sobre fondo neutro. {canEditMap ? "Si no puedes usar el puntero, todo lo que hace el mapa se hace también con la lista de puntos y los formularios de abajo." : ""}
          </p>
        </div>
        <div className="flex flex-col gap-4">
          <RouteSummary coords={coords} pois={pois} computedM={computedM} serverDistanceM={serverRevision?.computed_distance_m ?? null} modalities={routeModalities} saved={!isNew} />
          {!isNew ? <ValidationPanel validation={validation} dirty={dirty} editable={editable} modalityName={modalityName} timeZone={timeZone} /> : null}
        </div>
      </div>

      {problemsNow.geometry ? (
        <p role="alert" className="text-body-sm font-semibold text-danger" data-testid="geometry-problem">
          {problemsNow.geometry}
        </p>
      ) : null}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-2">
        <VertexPanel
          coords={coords}
          selected={editor.selected}
          canEdit={editable && wide && !preview}
          onSelect={(index) => {
            dispatch({ type: "select", index });
          }}
          onMove={move}
          onInsertAfter={(index) => insert(index + 1, midpoint(coords[index], coords[index + 1] ?? coords[index]))}
          onDelete={remove}
          onAdd={add}
          onSetEdge={(kind, index) => setEdge(kind, coords[index])}
          onCenter={centerOn}
        />
        <PoiPanel
          pois={pois}
          editable={editable && wide && !preview}
          problems={problemsNow.pois}
          canAdd={coords.length > 0}
          onUpdate={(key, patch) => dispatch({ type: "update_poi", key, patch })}
          onRemove={(key) => dispatch({ type: "remove_poi", key })}
          onAdd={(type) => {
            const anchor = coords[editor.selected ?? 0];
            if (anchor) dispatch({ type: "add_poi", poi: { key: newPoiKey(), poi_type: type, name: POI_TYPE_LABEL[type], description: "", longitude: anchor[0], latitude: anchor[1] } });
          }}
        />
      </div>

      <ConfirmDialog
        open={confirmingPublish}
        onOpenChange={setConfirmingPublish}
        title={`Publicar la revisión ${meta?.revision ?? ""}`}
        description={
          activeRevision && meta && activeRevision.route_revision_id !== meta.route_revision_id
            ? `La revisión ${activeRevision.revision} (publicada hoy) pasará a «Reemplazada» y el sitio público mostrará esta ruta en su lugar. La revisión publicada no se puede editar después: cualquier cambio será una revisión nueva.`
            : "El sitio público mostrará esta ruta. La revisión publicada no se puede editar después: cualquier cambio será una revisión nueva."
        }
        confirmLabel="Publicar revisión"
        onConfirm={({ idempotencyKey }) => publishRevision(serverRevision?.route_revision_id ?? "", idempotencyKey)}
        onDone={(result) => {
          adopt(result.data as RevisionFull);
          toast({ tone: "success", title: "Revisión publicada" });
          router.refresh();
        }}
      />

      <ConfirmDialog
        open={confirmingCopy !== null}
        onOpenChange={(open) => (open ? undefined : setConfirmingCopy(null))}
        title="Crear el borrador con la ruta simplificada"
        description={
          confirmingCopy && meta
            ? `El servidor acepta hasta ${formatBytes(REVISION_BODY_LIMIT_BYTES)} por guardado en este paso. Para copiar la revisión ${meta.revision} se quitan los puntos casi alineados (tolerancia ${confirmingCopy.toleranceM} m): el trazo pasa de ${(meta.geometry.coordinates.length).toLocaleString("es-MX")} a ${confirmingCopy.coords.length.toLocaleString("es-MX")} puntos y su longitud cambia unos ${Math.abs(Math.round(pathLengthM(confirmingCopy.coords) - pathLengthM(meta.geometry.coordinates as LonLat[]))).toLocaleString("es-MX")} m. La revisión original no cambia.`
            : ""
        }
        confirmLabel="Crear borrador simplificado"
        onConfirm={async ({ idempotencyKey }) => {
          if (!confirmingCopy || !serverRevision) return toApiResult<RevisionFull>(0, null);
          const body = { geometry: geometryInput(confirmingCopy.coords), pois: orderPois(serverRevision.pois.map(poiFromServer)).map(poiToInput) };
          return createRevision(route.route_id, body, idempotencyKey);
        }}
        onDone={(result) => {
          setConfirmingCopy(null);
          toast({ tone: "success", title: "Borrador creado a partir de la revisión" });
          router.push(`${pathname}?route=${route.route_id}&revision=${(result.data as RevisionFull).route_revision_id}`);
        }}
      />

      {serverRevision?.status === "PUBLISHED" ? (
        <p className="flex items-center gap-2 text-caption text-ink-60">
          <CircleCheck className="size-4 text-success" aria-hidden="true" />
          Esta es la revisión que ve el público.
        </p>
      ) : null}
    </div>
  );
}
