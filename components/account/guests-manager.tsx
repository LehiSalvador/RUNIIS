"use client";

import React from "react";
import Link from "next/link";
import { Archive, Pencil, Plus, RotateCcw, UserRound } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Modal, ModalActions, ModalClose, ModalContent } from "@/components/ui/modal";
import { Pagination } from "@/components/ui/pagination";
import { StatusBadge } from "@/components/ui/status-badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/use-toast";
import { ConfirmDialog } from "@/components/account/confirm-dialog";
import { PersonFieldsForm } from "@/components/account/person-fields-form";
import { RowList } from "@/components/account/section";
import { apiFetch, newIdempotencyKey, type ApiFailure } from "@/lib/client/api";
import { errorMessage, invalidFields } from "@/lib/client/account-errors";
import { formatCalendarDate } from "@/lib/client/account-format";
import { useReturnFocus } from "@/lib/client/focus";
import type { GuestView, Paged } from "@/lib/client/account-types";
import {
  FIELD_MESSAGES,
  PERSON_FIELD_ORDER,
  UNDER_MIN_AGE_MESSAGE,
  ageBand,
  ageOn,
  formatPhone,
  todayInBusinessZone,
  toPersonPayload,
  validatePersonFields,
  type PersonField,
  type PersonFields,
} from "@/lib/client/person-fields";

type Status = "ACTIVE" | "ARCHIVED";
const IDENTITY: readonly PersonField[] = ["full_name", "date_of_birth", "sex_code"];
const EMPTY: PersonFields = {
  full_name: "",
  date_of_birth: null,
  sex_code: "",
  phone_e164: "",
  emergency_contact_name: "",
  emergency_contact_phone_e164: "",
  emergency_contact_relationship: "",
};

function toFields(guest: GuestView): PersonFields {
  return {
    full_name: guest.full_name,
    date_of_birth: guest.date_of_birth,
    sex_code: guest.sex_code,
    phone_e164: formatPhone(guest.phone_e164),
    emergency_contact_name: guest.emergency_contact_name,
    emergency_contact_phone_e164: formatPhone(guest.emergency_contact_phone_e164),
    emergency_contact_relationship: guest.emergency_contact_relationship,
  };
}

function guestFailure(failure: ApiFailure): string {
  const reason = failure.details.reason;
  if (reason === "GUEST_HAS_FUTURE_PARTICIPATION") return "No se puede archivar: tiene una inscripción próxima.";
  if (reason === "GUEST_IDENTITY_LOCKED") return "El nombre, la fecha de nacimiento y el sexo ya no se pueden cambiar porque participa en una solicitud.";
  if (reason === "GUEST_ARCHIVED") return "Este invitado está archivado. Reactívalo para editarlo.";
  if (reason === "DUPLICATE_ARCHIVED_GUEST") return "Ya tienes a esta persona entre tus archivados. Reactívala desde la pestaña Archivados.";
  if (failure.code === "CONFLICT") return "Ya tienes un invitado con ese nombre y fecha de nacimiento.";
  if (failure.code === "RATE_LIMITED") return "Registraste muchos invitados hoy. Intenta de nuevo más tarde.";
  return errorMessage(failure);
}

async function fetchGuests(status: Status, cursor?: string) {
  const query = new URLSearchParams({ status });
  if (cursor) query.set("cursor", cursor);
  return apiFetch<GuestView[], { next_cursor?: string | null }>(`/api/v1/me/guests?${query}`);
}

/** J9 step 3-4 / Master §24-25: guests are created, edited, archived (never deleted) and reactivated by their owner. */
export function GuestsManager({ initialActive, initialArchived }: { initialActive: Paged<GuestView>; initialArchived: Paged<GuestView> }) {
  const [tab, setTab] = React.useState<Status>("ACTIVE");
  const [lists, setLists] = React.useState<Record<Status, Paged<GuestView>>>({ ACTIVE: initialActive, ARCHIVED: initialArchived });
  const [editor, setEditor] = React.useState<{ mode: "create" } | { mode: "edit"; guest: GuestView } | null>(null);
  const [archiveTarget, setArchiveTarget] = React.useState<GuestView | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const createButton = React.useRef<HTMLButtonElement>(null);

  async function reload() {
    const [active, archived] = await Promise.all([fetchGuests("ACTIVE"), fetchGuests("ARCHIVED")]);
    setLists((current) => ({
      ACTIVE: active.ok ? { items: active.data, nextCursor: active.meta.next_cursor ?? null } : current.ACTIVE,
      ARCHIVED: archived.ok ? { items: archived.data, nextCursor: archived.meta.next_cursor ?? null } : current.ARCHIVED,
    }));
  }

  async function loadMore() {
    const cursor = lists[tab].nextCursor;
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    const result = await fetchGuests(tab, cursor);
    setLoadingMore(false);
    if (result.ok) {
      setLists((current) => ({ ...current, [tab]: { items: [...current[tab].items, ...result.data], nextCursor: result.meta.next_cursor ?? null } }));
    }
  }

  async function reactivate(guest: GuestView) {
    if (busy) return;
    setBusy(guest.guest_participant_id);
    const result = await apiFetch(`/api/v1/me/guests/${guest.guest_participant_id}/reactivate`, { method: "POST" });
    setBusy(null);
    if (!result.ok) {
      toast({ tone: "danger", title: "No se pudo reactivar.", description: guestFailure(result) });
      return;
    }
    toast({ tone: "success", title: `Reactivamos a ${guest.full_name}` });
    await reload();
  }

  const today = todayInBusinessZone();

  function renderRow(guest: GuestView) {
    const age = ageOn(guest.date_of_birth, today);
    const archived = guest.status === "ARCHIVED";
    return (
      <li key={guest.guest_participant_id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between" data-testid="guest-row">
        <div className="min-w-0">
          <p className="text-body font-semibold text-ink">{guest.full_name}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-body-sm text-ink-60">
            <span>
              {age} años · {formatCalendarDate(guest.date_of_birth)}
            </span>
            <span>{formatPhone(guest.phone_e164)}</span>
          </p>
          {guest.is_minor && !archived ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {guest.guardian_status === "ACTIVE" ? (
                <StatusBadge state="REGISTRATION_CONFIRMED" label="Menor con adulto responsable" />
              ) : (
                <>
                  <StatusBadge state="REQUEST_PENDING" label={guest.guardian_status === "PENDING" ? "Adulto responsable por confirmar" : "Menor sin adulto responsable"} />
                  {guest.guardian_status === "NONE" ? (
                    <Link href="/cuenta/menores" className="text-body-sm font-semibold text-ink underline underline-offset-4">
                      Asignar adulto responsable
                    </Link>
                  ) : null}
                </>
              )}
            </div>
          ) : null}
          {archived && guest.archived_at ? <p className="mt-1 text-caption text-ink-60">Archivado el {formatCalendarDate(guest.archived_at.slice(0, 10))}</p> : null}
        </div>
        <div className="flex gap-2">
          {archived ? (
            <Button size="sm" variant="secondary" loading={busy === guest.guest_participant_id} onClick={() => reactivate(guest)}>
              <RotateCcw className="size-4" aria-hidden="true" />
              Reactivar<span className="sr-only"> a {guest.full_name}</span>
            </Button>
          ) : (
            <>
              <Button size="sm" variant="secondary" onClick={() => setEditor({ mode: "edit", guest })}>
                <Pencil className="size-4" aria-hidden="true" />
                Editar<span className="sr-only"> a {guest.full_name}</span>
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setArchiveTarget(guest)}>
                <Archive className="size-4" aria-hidden="true" />
                Archivar<span className="sr-only"> a {guest.full_name}</span>
              </Button>
            </>
          )}
        </div>
      </li>
    );
  }

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button ref={createButton} onClick={() => setEditor({ mode: "create" })} className="w-full sm:w-auto">
          <Plus className="size-4" aria-hidden="true" />
          Agregar invitado
        </Button>
      </div>
      <Tabs value={tab} onValueChange={(value) => setTab(value as Status)}>
        <TabsList aria-label="Estado de invitados">
          <TabsTrigger value="ACTIVE">Activos</TabsTrigger>
          <TabsTrigger value="ARCHIVED">Archivados</TabsTrigger>
        </TabsList>
        {(["ACTIVE", "ARCHIVED"] as const).map((status) => (
          <TabsContent key={status} value={status} className="pt-6 outline-none">
            {lists[status].items.length === 0 ? (
              <EmptyState
                icon={UserRound}
                title={status === "ACTIVE" ? "Aún no tienes invitados" : "No tienes invitados archivados"}
                description={
                  status === "ACTIVE"
                    ? "Agrega a quienes no tienen cuenta (por ejemplo, familiares) para inscribirlos contigo."
                    : "Los invitados sin carreras recientes se archivan solos; puedes reactivarlos cuando quieras."
                }
                action={status === "ACTIVE" ? <Button onClick={() => setEditor({ mode: "create" })}>Agregar invitado</Button> : undefined}
                className="rounded-card border border-divider bg-paper-raised"
              />
            ) : (
              <>
                <RowList label={status === "ACTIVE" ? "Invitados activos" : "Invitados archivados"}>{lists[status].items.map(renderRow)}</RowList>
                <Pagination variant="cursor" hasMore={Boolean(lists[status].nextCursor)} loading={loadingMore} onLoadMore={loadMore} className="mt-4" />
              </>
            )}
          </TabsContent>
        ))}
      </Tabs>

      <GuestEditor
        state={editor}
        onClose={() => setEditor(null)}
        onSaved={async (guest, created) => {
          setEditor(null);
          toast({ tone: "success", title: created ? `Agregamos a ${guest.full_name}` : "Cambios guardados" });
          setTab("ACTIVE");
          await reload();
        }}
      />

      <ConfirmDialog
        open={archiveTarget !== null}
        onOpenChange={(open) => !open && setArchiveTarget(null)}
        title={`¿Archivar a ${archiveTarget?.full_name ?? ""}?`}
        description="No se borra: dejará de aparecer al inscribir y podrás reactivarlo cuando quieras."
        confirmLabel="Archivar"
        onConfirm={async () => {
          if (!archiveTarget) return null;
          const result = await apiFetch(`/api/v1/me/guests/${archiveTarget.guest_participant_id}`, { method: "DELETE" });
          if (!result.ok) return result;
          toast({ tone: "info", title: `Archivamos a ${archiveTarget.full_name}` });
          await reload();
          return null;
        }}
        describeFailure={guestFailure}
      />
    </>
  );
}

function GuestEditor({
  state,
  onClose,
  onSaved,
}: {
  state: { mode: "create" } | { mode: "edit"; guest: GuestView } | null;
  onClose: () => void;
  onSaved: (guest: GuestView, created: boolean) => Promise<void>;
}) {
  const editing = state?.mode === "edit" ? state.guest : null;
  const [values, setValues] = React.useState<PersonFields>(EMPTY);
  const [errors, setErrors] = React.useState<Map<PersonField, string>>(new Map());
  const [formError, setFormError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const elements = React.useRef(new Map<PersonField, HTMLElement | null>());
  const [openedFor, setOpenedFor] = React.useState<typeof state>(null);
  const returnFocus = useReturnFocus(state !== null);

  if (state !== openedFor) {
    setOpenedFor(state);
    if (state) {
      setValues(state.mode === "edit" ? toFields(state.guest) : EMPTY);
      setErrors(new Map());
      setFormError(null);
    }
  }

  const today = todayInBusinessZone();
  const band = values.date_of_birth && values.date_of_birth <= today ? ageBand(ageOn(values.date_of_birth, today)) : null;
  const locked = editing?.identity_locked ? new Set<PersonField>(IDENTITY) : undefined;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending || !state) return;
    const fieldErrors = validatePersonFields(values, today);
    setErrors(fieldErrors);
    if (fieldErrors.size > 0) {
      setFormError("Revisa los datos marcados.");
      elements.current.get(PERSON_FIELD_ORDER.find((field) => fieldErrors.has(field))!)?.focus();
      return;
    }
    const payload = toPersonPayload(values);
    let body: Record<string, string> = payload;
    if (editing) {
      const original = toPersonPayload(toFields(editing));
      body = Object.fromEntries(Object.entries(payload).filter(([key, value]) => original[key as keyof typeof original] !== value));
      if (Object.keys(body).length === 0) {
        onClose();
        return;
      }
    }
    setFormError(null);
    setPending(true);
    const result = editing
      ? await apiFetch<GuestView>(`/api/v1/me/guests/${editing.guest_participant_id}`, { method: "PATCH", body })
      : await apiFetch<GuestView>("/api/v1/me/guests", { method: "POST", body, idempotencyKey: newIdempotencyKey() });
    setPending(false);
    if (result.ok) {
      await onSaved(result.data, !editing);
      return;
    }
    const mapped = new Map<PersonField, string>();
    for (const [field, reason] of invalidFields(result)) {
      if ((PERSON_FIELD_ORDER as readonly string[]).includes(field)) {
        mapped.set(field as PersonField, reason === "UNDER_MIN_AGE" ? UNDER_MIN_AGE_MESSAGE : FIELD_MESSAGES[field as PersonField]);
      }
    }
    setErrors(mapped);
    setFormError(mapped.size > 0 ? "Revisa los datos marcados." : guestFailure(result));
  }

  return (
    <Modal open={state !== null} onOpenChange={(open) => !open && !pending && onClose()}>
      <ModalContent
        onCloseAutoFocus={returnFocus}
        title={editing ? `Editar a ${editing.full_name}` : "Agregar invitado"}
        description={editing ? undefined : "Todos los datos son obligatorios. Los usamos solo para su inscripción y su seguridad en el evento."}
      >
        <form onSubmit={submit} noValidate>
          {formError ? <Alert tone="danger" title={formError} className="mb-4" /> : null}
          <PersonFieldsForm
            idPrefix="guest"
            values={values}
            errors={errors}
            lockedFields={locked}
            maxDate={today}
            labels={{ full_name: "Nombre completo del invitado" }}
            onChange={(field, value) => {
              setValues((current) => ({ ...current, [field]: value ?? (field === "date_of_birth" ? null : "") }));
              setFormError(null);
              if (errors.has(field)) setErrors((current) => new Map([...current].filter(([key]) => key !== field)));
            }}
            fieldRef={(field, element) => elements.current.set(field, element)}
            afterDateOfBirth={
              band === "MINOR" ? (
                <Alert tone="info" title="Invitado menor de edad" className="mb-4">
                  Antes de inscribirlo necesitará un adulto responsable (puedes ser tú). Lo asignas en Menores.
                </Alert>
              ) : null
            }
          />
          <ModalActions>
            <ModalClose asChild>
              <Button variant="secondary" disabled={pending}>
                Cancelar
              </Button>
            </ModalClose>
            <Button type="submit" loading={pending}>
              {editing ? "Guardar cambios" : "Agregar invitado"}
            </Button>
          </ModalActions>
        </form>
      </ModalContent>
    </Modal>
  );
}
