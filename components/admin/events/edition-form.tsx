"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";
import { apiFetch, newIdempotencyKey, type ApiFailure } from "@/lib/client/api";
import { Panel } from "@/components/admin/panel";
import { CheckField, InputField, RefusalNotice, SelectField, serverFieldErrors } from "@/components/admin/events/fields";
import {
  TIMEZONE_OPTIONS,
  buildCreateEditionBody,
  buildEditionChanges,
  changedEditionFieldLabels,
  emptyEditionValues,
  isStaleState,
  isValidSlug,
  rebaseEditionValues,
  sameEditionValues,
  slugify,
  validateEditionValues,
  type EditionFormValues,
  type FieldErrors,
} from "@/components/admin/events/form-logic";
import { UnsavedChangesGuard } from "@/components/admin/events/unsaved-guard";

/** One row of the Events catalogue (GET /api/v1/admin/events/list): an Event may have no Edition yet. */
export type EventChoice = {
  event_id: string;
  name: string;
  canonical_key: string;
  status: string;
  event_type_key: string;
  event_type_name: string;
  edition_count: number;
};
export type EventTypeChoice = { key: string; name: string };

type CreateProps = {
  mode: "create";
  events: readonly EventChoice[];
  eventTypes: readonly EventTypeChoice[];
  /** The catalogue has more Events than were loaded: the picker says so. */
  eventsTruncated?: boolean;
};

type EditProps = {
  mode: "edit";
  editionId: string;
  baseline: EditionFormValues;
  publicationState: string;
  isAdmin: boolean;
  /**
   * `edition.updated_at` exactly as the server returned it. Sent verbatim as `expected_updated_at` on the save, so a
   * change made by someone else meanwhile is refused (409 STALE_STATE) instead of silently overwritten (P3-L, P3-AC-15).
   */
  updatedAt: string;
};

const MODE_OPTIONS = [
  { value: "EXTERNAL_WHATSAPP", label: "Por WhatsApp: el staff confirma cada solicitud" },
  { value: "FREE", label: "Gratuita: confirma al instante" },
];

const NEW_EVENT = "__new__";

function newIntent() {
  return { key: newIdempotencyKey(), fingerprint: "" };
}

export function EditionForm(props: CreateProps | EditProps) {
  return props.mode === "create" ? <CreateForm {...props} /> : <EditForm key={props.editionId} {...props} />;
}

// ---------------------------------------------------------------------------------------------
// Shared field groups
// ---------------------------------------------------------------------------------------------

type GroupProps = {
  values: EditionFormValues;
  errors: FieldErrors;
  set: <K extends keyof EditionFormValues>(key: K, value: EditionFormValues[K]) => void;
  onName?: (name: string) => void;
  onSlug?: (slug: string) => void;
  disabled?: Partial<Record<keyof EditionFormValues, string>>;
};

function describe(disabled: GroupProps["disabled"], key: keyof EditionFormValues, helper: string): string {
  return disabled?.[key] ?? helper;
}

function GeneralFields({ values, errors, set, onName, onSlug, disabled }: GroupProps) {
  return (
    <Panel title="Datos generales">
      <div className="grid gap-x-4 sm:grid-cols-2">
        <InputField
          id="edition-name"
          name="name"
          label="Nombre de la edición"
          required
          value={values.name}
          error={errors.name}
          maxLength={160}
          autoComplete="off"
          onChange={(event) => (onName ? onName(event.target.value) : set("name", event.target.value))}
        />
        <InputField
          id="edition-slug"
          name="slug"
          label="Enlace público (slug)"
          required
          value={values.slug}
          error={errors.slug}
          helperText={`Dirección: /eventos/${values.slug || "…"}. Si lo cambias después, el enlace anterior redirige al nuevo.`}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => (onSlug ? onSlug(event.target.value) : set("slug", event.target.value))}
        />
        <InputField
          id="edition-city"
          name="city"
          label="Ciudad"
          required
          value={values.city}
          error={errors.city}
          autoComplete="off"
          onChange={(event) => set("city", event.target.value)}
        />
        <InputField
          id="edition-state"
          name="state_region"
          label="Estado"
          required
          value={values.state_region}
          error={errors.state_region}
          autoComplete="off"
          onChange={(event) => set("state_region", event.target.value)}
        />
        <InputField
          id="edition-country"
          name="country_code"
          label="País (código de 2 letras)"
          required
          value={values.country_code}
          error={errors.country_code}
          maxLength={2}
          autoComplete="off"
          onChange={(event) => set("country_code", event.target.value.toUpperCase())}
        />
        <SelectField
          id="edition-timezone"
          name="timezone"
          label="Zona horaria de la edición"
          required
          value={values.timezone}
          error={errors.timezone}
          disabled={Boolean(disabled?.timezone)}
          helperText={describe(disabled, "timezone", "Todas las horas de esta edición se leen en esta zona.")}
          options={
            TIMEZONE_OPTIONS.some((option) => option.value === values.timezone)
              ? TIMEZONE_OPTIONS
              : [...TIMEZONE_OPTIONS, { value: values.timezone, label: values.timezone }]
          }
          onChange={(event) => set("timezone", event.target.value)}
        />
      </div>
      <CheckField
        id="edition-benefit"
        label="Evento a beneficio"
        checked={values.is_benefit_event}
        onChange={(checked) => set("is_benefit_event", checked)}
      />
    </Panel>
  );
}

function DateFields({ values, errors, set, disabled }: GroupProps) {
  const zone = values.timezone;
  return (
    <Panel title="Fechas clave" description={`Fecha y horas de la carrera y ventana de inscripciones, en la zona de la edición (${zone}).`}>
      <div className="grid gap-x-4 sm:grid-cols-3">
        <InputField
          id="edition-date"
          name="local_date"
          type="date"
          label="Fecha de la carrera"
          value={values.local_date}
          error={errors.local_date}
          disabled={Boolean(disabled?.local_date)}
          helperText={describe(disabled, "local_date", "Puedes dejarla vacía mientras no esté definida.")}
          onChange={(event) => set("local_date", event.target.value)}
        />
        <InputField
          id="edition-start"
          name="local_start_time"
          type="time"
          label="Hora de inicio"
          value={values.local_start_time}
          error={errors.local_start_time}
          disabled={Boolean(disabled?.local_start_time)}
          helperText={describe(disabled, "local_start_time", "Opcional.")}
          onChange={(event) => set("local_start_time", event.target.value)}
        />
        <InputField
          id="edition-end"
          name="local_end_time"
          type="time"
          label="Hora de término"
          value={values.local_end_time}
          error={errors.local_end_time}
          disabled={Boolean(disabled?.local_end_time)}
          helperText={describe(disabled, "local_end_time", "Opcional.")}
          onChange={(event) => set("local_end_time", event.target.value)}
        />
        <InputField
          id="edition-reg-open"
          name="registration_open_at"
          type="datetime-local"
          label="Apertura de inscripciones"
          value={values.registration_open_at}
          error={errors.registration_open_at}
          disabled={Boolean(disabled?.registration_open_at)}
          helperText={describe(disabled, "registration_open_at", "Opcional. Vacía: sin fecha de apertura automática.")}
          onChange={(event) => set("registration_open_at", event.target.value)}
        />
        <InputField
          id="edition-reg-close"
          name="registration_close_at"
          type="datetime-local"
          label="Cierre de inscripciones"
          value={values.registration_close_at}
          error={errors.registration_close_at}
          disabled={Boolean(disabled?.registration_close_at)}
          helperText={describe(disabled, "registration_close_at", "Vacío al crear: el servidor lo calcula a partir de la fecha de la carrera.")}
          onChange={(event) => set("registration_close_at", event.target.value)}
        />
      </div>
    </Panel>
  );
}

function RegistrationFields({ values, errors, set, disabled }: GroupProps) {
  return (
    <Panel title="Inscripción">
      <div className="grid gap-x-4 sm:grid-cols-2">
        <SelectField
          id="edition-mode"
          name="registration_mode"
          label="Modo de inscripción"
          required
          value={values.registration_mode}
          options={MODE_OPTIONS}
          disabled={Boolean(disabled?.registration_mode)}
          helperText={describe(disabled, "registration_mode", "Modelo V1: sin pasarela de pago. Los precios son informativos.")}
          onChange={(event) => set("registration_mode", event.target.value === "FREE" ? "FREE" : "EXTERNAL_WHATSAPP")}
        />
        <InputField
          id="edition-whatsapp"
          name="whatsapp_phone_e164"
          label="WhatsApp de la edición"
          value={values.whatsapp_phone_e164}
          error={errors.whatsapp_phone_e164}
          inputMode="tel"
          autoComplete="off"
          helperText="Formato +528110814941. Vacío: se usa el número predeterminado de la plataforma."
          onChange={(event) => set("whatsapp_phone_e164", event.target.value.replace(/\s/g, ""))}
        />
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------------------------

function CreateForm({ events, eventTypes, eventsTruncated }: CreateProps) {
  const router = useRouter();
  const [values, setValues] = React.useState<EditionFormValues>(emptyEditionValues);
  const [slugTouched, setSlugTouched] = React.useState(false);
  const [eventChoice, setEventChoice] = React.useState<string>(events.length > 0 ? events[0].event_id : NEW_EVENT);
  const [eventTypeKey, setEventTypeKey] = React.useState(eventTypes[0]?.key ?? "");
  const [eventName, setEventName] = React.useState("");
  const [eventKey, setEventKey] = React.useState("");
  const [eventKeyTouched, setEventKeyTouched] = React.useState(false);
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [failure, setFailure] = React.useState<ApiFailure | null>(null);
  const [pending, setPending] = React.useState(false);
  // An Event created in a first step that must not be created twice if the Edition step fails.
  const [createdEventId, setCreatedEventId] = React.useState<string | null>(null);
  const eventIntent = React.useRef(newIntent());
  const editionIntent = React.useRef(newIntent());
  const submitting = React.useRef(false);

  const creatingEvent = eventChoice === NEW_EVENT && createdEventId === null;
  const pickedEvent = createdEventId === null ? (events.find((entry) => entry.event_id === eventChoice) ?? null) : null;
  const dirty = !sameEditionValues(values, emptyEditionValues()) || eventName !== "";

  const set = <K extends keyof EditionFormValues>(key: K, value: EditionFormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => (current[key] ? { ...current, [key]: undefined } : current));
  };

  function submit(event: React.FormEvent) {
    event.preventDefault();
    void run();
  }

  async function run() {
    if (submitting.current) return;
    const next = validateEditionValues(values, "create");
    if (creatingEvent) {
      if (!eventTypeKey) next.event_type_key = "Elige un tipo de evento.";
      if (!eventName.trim()) next.event_name = "Este campo es obligatorio.";
      if (!isValidSlug(eventKey)) next.canonical_key = "Usa de 3 a 120 caracteres: minúsculas, números y guiones.";
    }
    setErrors(next);
    if (Object.values(next).some(Boolean)) {
      const first = Object.keys(next).find((name) => next[name]);
      if (first) document.querySelector<HTMLElement>(`[name="${first}"], #${first}`)?.focus();
      return;
    }

    submitting.current = true;
    setPending(true);
    setFailure(null);
    try {
      let eventId = createdEventId ?? (eventChoice === NEW_EVENT ? null : eventChoice);
      if (eventId === null) {
        const body = { event_type_key: eventTypeKey, name: eventName.trim(), canonical_key: eventKey };
        const fingerprint = JSON.stringify(body);
        if (eventIntent.current.fingerprint !== fingerprint) eventIntent.current = { key: newIdempotencyKey(), fingerprint };
        const created = await apiFetch<{ event_id: string }>("/api/v1/admin/events", {
          method: "POST",
          body,
          idempotencyKey: eventIntent.current.key,
        });
        if (!created.ok) {
          setFailure(created);
          const fields = serverFieldErrors(created);
          setErrors({
            canonical_key: fields.canonical_key,
            event_name: fields.name,
            event_type_key: fields.event_type_key,
          });
          return;
        }
        eventId = created.data.event_id;
        setCreatedEventId(eventId);
      }

      const body = { event_id: eventId, ...buildCreateEditionBody(values) };
      const fingerprint = JSON.stringify(body);
      if (editionIntent.current.fingerprint !== fingerprint) editionIntent.current = { key: newIdempotencyKey(), fingerprint };
      const created = await apiFetch<{ edition_id: string }>("/api/v1/admin/editions", {
        method: "POST",
        body,
        idempotencyKey: editionIntent.current.key,
      });
      if (!created.ok) {
        setFailure(created);
        setErrors(serverFieldErrors(created));
        return;
      }
      toast({ tone: "success", title: "Edición creada como borrador", description: "Configura modalidades y precios, revisa los requisitos y publica." });
      setCreatedEventId(null);
      router.push(`/admin/eventos/${created.data.edition_id}`);
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4" aria-label="Nueva edición">
      <UnsavedChangesGuard dirty={dirty && !pending} />

      <Panel title="Evento" description="Una edición pertenece a un evento (por ejemplo, el mismo maratón año con año).">
        <div className="grid gap-x-4 sm:grid-cols-2">
          <SelectField
            id="event-choice"
            name="event_choice"
            label="Evento"
            required
            value={createdEventId ?? eventChoice}
            disabled={createdEventId !== null}
            options={[
              ...events.map((entry) => ({
                value: entry.event_id,
                label: `${entry.name} · ${entry.event_type_name} · ${entry.edition_count === 0 ? "sin ediciones" : `${entry.edition_count} ${entry.edition_count === 1 ? "edición" : "ediciones"}`}`,
              })),
              ...(createdEventId ? [{ value: createdEventId, label: `${eventName} (recién creado)` }] : []),
              { value: NEW_EVENT, label: "Crear un evento nuevo…" },
            ]}
            helperText={
              createdEventId
                ? "El evento ya se creó. Corrige la edición y vuelve a intentar: no se creará otro evento."
                : events.length === 0
                  ? "Todavía no hay eventos: crea el primero."
                  : eventsTruncated
                    ? "Se muestran los eventos activos más recientes; si no ves el tuyo, créalo como nuevo o búscalo desde Eventos."
                    : "Eventos activos, incluidos los que todavía no tienen ediciones."
            }
            onChange={(event) => setEventChoice(event.target.value)}
          />
        </div>
        {pickedEvent ? (
          <dl className="grid gap-x-6 gap-y-1 rounded-control border border-divider bg-paper-sunken px-3 py-2 text-body-sm sm:grid-cols-3" data-testid="picked-event">
            <div>
              <dt className="text-caption text-ink-60">Tipo de evento</dt>
              <dd className="font-semibold text-ink">{pickedEvent.event_type_name}</dd>
            </div>
            <div>
              <dt className="text-caption text-ink-60">Clave permanente</dt>
              <dd className="font-mono text-ink">{pickedEvent.canonical_key}</dd>
            </div>
            <div>
              <dt className="text-caption text-ink-60">Estado y ediciones</dt>
              <dd className="font-semibold text-ink">
                {pickedEvent.status === "ACTIVE" ? "Activo" : "Archivado"} ·{" "}
                {pickedEvent.edition_count === 0 ? "sin ediciones todavía" : `${pickedEvent.edition_count} ${pickedEvent.edition_count === 1 ? "edición" : "ediciones"}`}
              </dd>
            </div>
          </dl>
        ) : null}
        {creatingEvent ? (
          <div className="grid gap-x-4 sm:grid-cols-3" data-testid="new-event-fields">
            <SelectField
              id="event-type"
              name="event_type_key"
              label="Tipo de evento"
              required
              value={eventTypeKey}
              error={errors.event_type_key}
              options={eventTypes.length > 0 ? eventTypes.map((type) => ({ value: type.key, label: type.name })) : [{ value: "", label: "Sin tipos disponibles" }]}
              onChange={(event) => setEventTypeKey(event.target.value)}
            />
            <InputField
              id="event-name"
              name="event_name"
              label="Nombre del evento"
              required
              value={eventName}
              error={errors.event_name}
              maxLength={160}
              autoComplete="off"
              onChange={(event) => {
                setEventName(event.target.value);
                if (!eventKeyTouched) setEventKey(slugify(event.target.value));
                setErrors((current) => ({ ...current, event_name: undefined }));
              }}
            />
            <InputField
              id="event-key"
              name="canonical_key"
              label="Clave del evento"
              required
              value={eventKey}
              error={errors.canonical_key}
              helperText="Identidad permanente del evento; no se puede cambiar después."
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => {
                setEventKeyTouched(true);
                setEventKey(event.target.value);
                setErrors((current) => ({ ...current, canonical_key: undefined }));
              }}
            />
          </div>
        ) : null}
      </Panel>

      <GeneralFields
        values={values}
        errors={errors}
        set={set}
        onName={(name) => {
          set("name", name);
          if (!slugTouched) set("slug", slugify(name));
        }}
        onSlug={(slug) => {
          setSlugTouched(true);
          set("slug", slug);
        }}
      />
      <DateFields values={values} errors={errors} set={set} />
      <RegistrationFields values={values} errors={errors} set={set} />
      <Panel title="Capacidad total" description="Opcional. La capacidad por modalidad se define en Modalidades y precios; los lugares libres siempre se calculan.">
        <InputField
          id="edition-capacity"
          name="global_capacity"
          label="Capacidad total de la edición"
          inputMode="numeric"
          value={values.global_capacity}
          error={errors.global_capacity}
          helperText="Vacío: sin límite global."
          autoComplete="off"
          className="max-w-xs"
          onChange={(event) => set("global_capacity", event.target.value)}
        />
      </Panel>

      {failure ? <RefusalNotice failure={failure} onRetry={() => void run()} /> : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" loading={pending}>
          Crear edición como borrador
        </Button>
        <Link href="/admin/eventos" prefetch={false} className={buttonVariants({ variant: "secondary" })}>
          Cancelar
        </Link>
        <p className="text-caption text-ink-60">Se crea como borrador: no es pública hasta que la publiques con todos los requisitos.</p>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------------------------
// Edit
// ---------------------------------------------------------------------------------------------

function EditForm({ editionId, baseline: serverBaseline, updatedAt, publicationState, isAdmin }: EditProps) {
  const router = useRouter();
  const [token, setToken] = React.useState(updatedAt);
  const [baseline, setBaseline] = React.useState(serverBaseline);
  const [values, setValues] = React.useState(serverBaseline);
  const [serverSeen, setServerSeen] = React.useState({ updatedAt, baseline: serverBaseline });
  const [changedByOthers, setChangedByOthers] = React.useState<string[]>([]);
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [failure, setFailure] = React.useState<ApiFailure | null>(null);
  const [pending, setPending] = React.useState(false);
  const [saved, setSaved] = React.useState<string | null>(null);
  const submitting = React.useRef(false);

  // The server page re-rendered with a different Edition (after a save, or after a stale refusal and refetch): adopt it as the new
  // baseline and token WITHOUT dropping what the operator is typing (a field they did not touch takes the fresh value).
  if (serverSeen.updatedAt !== updatedAt || !sameEditionValues(serverSeen.baseline, serverBaseline)) {
    const others = changedEditionFieldLabels(baseline, serverBaseline);
    setServerSeen({ updatedAt, baseline: serverBaseline });
    setToken(updatedAt);
    setBaseline(serverBaseline);
    setValues(rebaseEditionValues(baseline, serverBaseline, values));
    if (others.length > 0) setChangedByOthers(others);
  }

  const draft = publicationState === "DRAFT";
  const dirty = !sameEditionValues(values, baseline);
  const changes = React.useMemo(() => buildEditionChanges(baseline, values, isAdmin), [baseline, values, isAdmin]);

  const set = <K extends keyof EditionFormValues>(key: K, value: EditionFormValues[K]) => {
    setSaved(null);
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => (current[key] ? { ...current, [key]: undefined } : current));
  };

  const adminOnly = "Solo un administrador cambia esto.";
  const disabled: GroupProps["disabled"] = {
    ...(isAdmin ? {} : { registration_mode: adminOnly, registration_open_at: adminOnly, registration_close_at: adminOnly }),
    ...(draft ? {} : { timezone: "La zona horaria no se puede cambiar después de publicar." }),
    ...(draft ? {} : { local_date: "Con la edición publicada, la fecha solo cambia al aplazar o reprogramar (Estado y publicación)." }),
    ...(draft || isAdmin ? {} : { local_start_time: adminOnly, local_end_time: adminOnly }),
  };

  function submit(event: React.FormEvent) {
    event.preventDefault();
    void run();
  }

  /** The server refused: keep what the operator typed, show why, and when the Edition moved on, refetch it. */
  function refused(result: ApiFailure) {
    setFailure(result);
    setErrors(isStaleState(result) ? {} : serverFieldErrors(result));
    if (isStaleState(result)) router.refresh();
  }

  async function run() {
    if (submitting.current) return;
    const next = validateEditionValues(values, "edit");
    setErrors(next);
    if (Object.values(next).some(Boolean)) {
      const first = Object.keys(next).find((name) => next[name]);
      if (first) document.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
      return;
    }
    if (!changes.patch && !changes.schedule) {
      setSaved("No hay cambios que guardar.");
      return;
    }

    submitting.current = true;
    setPending(true);
    setFailure(null);
    setSaved(null);
    setChangedByOthers([]);
    try {
      let current = baseline;
      // Every write carries the `updated_at` the form was loaded with; a write that changes the Edition hands back the new one.
      let expected = token;
      if (changes.patch) {
        const result = await apiFetch<{ updated_at?: unknown }>(`/api/v1/admin/editions/${editionId}`, {
          method: "PATCH",
          body: { ...changes.patch, expected_updated_at: expected },
        });
        if (!result.ok) return refused(result);
        // Only what the server confirmed becomes the new baseline.
        current = { ...current, ...pickPatched(values, changes.patch) };
        setBaseline(current);
        if (typeof result.data.updated_at === "string") {
          expected = result.data.updated_at;
          setToken(expected);
        }
      }
      if (changes.schedule) {
        const result = await apiFetch<{ edition?: { updated_at?: unknown } }>(`/api/v1/admin/editions/${editionId}/schedule`, {
          method: "POST",
          body: { ...changes.schedule, expected_updated_at: expected },
        });
        if (!result.ok) return refused(result);
        current = { ...current, local_date: values.local_date, local_start_time: values.local_start_time, local_end_time: values.local_end_time };
        setBaseline(current);
        const fresh = result.data.edition?.updated_at;
        if (typeof fresh === "string") setToken(fresh);
      }
      setSaved("Cambios guardados.");
      toast({ tone: "success", title: "Edición actualizada", description: changes.labels.join(", ") });
      router.refresh();
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4" aria-label="Editar edición">
      <UnsavedChangesGuard dirty={dirty && !pending} />
      {changedByOthers.length > 0 ? (
        <p className="rounded-control border border-info-border bg-info-tint px-3 py-2 text-body-sm text-ink" role="status" data-testid="changed-by-others">
          Se actualizó con la versión vigente de la edición. Otra persona cambió: {changedByOthers.join(", ")}. {dirty ? "Tus cambios sin guardar se conservaron." : null}
        </p>
      ) : null}
      <GeneralFields values={values} errors={errors} set={set} disabled={disabled} />
      <DateFields values={values} errors={errors} set={set} disabled={disabled} />
      <RegistrationFields values={values} errors={errors} set={set} disabled={disabled} />

      {failure ? <RefusalNotice failure={failure} onRetry={() => void run()} /> : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={pending} disabled={!dirty && !pending}>
          Guardar cambios
        </Button>
        {dirty ? (
          <>
            <Button type="button" variant="secondary" disabled={pending} onClick={() => { setValues(baseline); setErrors({}); setFailure(null); }}>
              Descartar cambios
            </Button>
            <p className="text-caption text-ink-60" role="status">
              Sin guardar: {changes.labels.length > 0 ? changes.labels.join(", ") : "cambios en revisión"}.
            </p>
          </>
        ) : saved ? (
          <p className="text-body-sm font-semibold text-success" role="status">
            {saved}
          </p>
        ) : null}
      </div>
    </form>
  );
}

/**
 * The slice of the form the PATCH actually carried, so the baseline moves only for fields the server confirmed. Text the API
 * normalises (trim, upper-case country) is taken from the request body, so the baseline equals what the server stores.
 */
function pickPatched(values: EditionFormValues, patch: Record<string, unknown>): Partial<EditionFormValues> {
  const out: Partial<EditionFormValues> = {};
  const keys: (keyof EditionFormValues)[] = [
    "name", "slug", "timezone", "city", "state_region", "country_code", "registration_mode",
    "registration_open_at", "registration_close_at", "whatsapp_phone_e164", "is_benefit_event",
  ];
  const normalised = new Set<keyof EditionFormValues>(["name", "city", "state_region", "country_code"]);
  for (const key of keys) {
    if (!(key in patch)) continue;
    if (normalised.has(key) && typeof patch[key] === "string") (out as Record<string, unknown>)[key] = patch[key];
    else (out as Record<string, unknown>)[key] = values[key];
  }
  return out;
}
