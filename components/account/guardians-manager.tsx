"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Plus, ShieldCheck } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Modal, ModalActions, ModalClose, ModalContent } from "@/components/ui/modal";
import { RadioGroup, RadioItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { toast } from "@/components/ui/use-toast";
import { ConfirmDialog } from "@/components/account/confirm-dialog";
import { AccountSection, KindBadge, RowList } from "@/components/account/section";
import { apiFetch, type ApiFailure } from "@/lib/client/api";
import { errorMessage } from "@/lib/client/account-errors";
import { GUARDIAN_RELATIONSHIP_LABELS, formatCalendarDate } from "@/lib/client/account-format";
import { useReturnFocus } from "@/lib/client/focus";
import type { GuardianAssignmentView, GuestView, PublicCard } from "@/lib/client/account-types";

const REASONS: Record<string, string> = {
  SELF_GUARDIAN: "No puedes ser tu propio adulto responsable.",
  GUARDIAN_NOT_ADULT: "El adulto responsable debe tener 18 años o más.",
  COUNTERPART_NOT_MINOR: "Esa persona no tiene entre 15 y 17 años.",
  NOT_A_MINOR: "Esa persona ya no es menor de edad.",
  UNDER_MIN_AGE: "RUNIIS requiere al menos 15 años.",
  GUEST_NOT_MINOR: "Ese invitado ya es mayor de edad.",
  GUARDIAN_NOT_FRIEND: "El adulto responsable debe ser tu amistad en RUNIIS.",
  ASSIGNMENT_EXISTS: "Ya existe una vinculación activa o pendiente para este menor.",
  AWAITING_COUNTERPART: "Falta que la otra persona confirme.",
  ASSIGNMENT_REVOKED: "Esta vinculación ya fue revocada.",
  GUEST_ARCHIVED: "Ese invitado está archivado. Reactívalo primero.",
  GUARDIAN_UNAVAILABLE: "El adulto responsable ya no está disponible.",
  COUNTERPART_UNAVAILABLE: "La otra persona ya no está disponible.",
};

function guardianFailure(failure: ApiFailure): string {
  const reason = typeof failure.details.reason === "string" ? failure.details.reason : "";
  return REASONS[reason] ?? errorMessage(failure);
}

function minorName(assignment: GuardianAssignmentView): string {
  const minor = assignment.minor;
  if (!minor) return "Menor";
  return "display_name" in minor ? minor.display_name : (minor.full_name ?? "Invitado menor");
}

function describe(assignment: GuardianAssignmentView): { title: string; detail: string } {
  const relationship = GUARDIAN_RELATIONSHIP_LABELS[assignment.relationship_type] ?? assignment.relationship_type;
  const guardian = assignment.guardian?.display_name ?? "Adulto responsable";
  const minor = minorName(assignment);
  if (assignment.my_roles.includes("MINOR")) return { title: `${guardian} es tu adulto responsable`, detail: relationship };
  if (assignment.my_roles.includes("GUARDIAN") && !assignment.my_roles.includes("GUEST_OWNER")) {
    return { title: `Eres adulto responsable de ${minor}`, detail: `${relationship}${assignment.guest_owner ? ` · invitado de ${assignment.guest_owner.display_name}` : ""}` };
  }
  return { title: `${minor}`, detail: `Adulto responsable: ${assignment.my_roles.includes("GUARDIAN") ? "tú" : guardian} · ${relationship}` };
}

function statusBadge(assignment: GuardianAssignmentView) {
  if (assignment.status === "ACTIVE") return <StatusBadge state="REGISTRATION_CONFIRMED" label="Activa" />;
  if (assignment.status === "REVOKED") return <StatusBadge state="CLOSED" label="Revocada" />;
  return (
    <StatusBadge
      state="REQUEST_PENDING"
      label={assignment.awaiting_confirmation_by === "ME" ? "Falta tu confirmación" : "Esperando a la otra persona"}
    />
  );
}

/**
 * J9 step 5-6 / ADR-001 A10: GuardianAssignment lifecycle. A runner-minor link is ACTIVE only after
 * both people confirm in-app; a Guest-minor link needs only the guardian. Either party revokes.
 */
export function GuardiansManager({
  assignments,
  friends,
  minorGuests,
  viewerIsMinor,
}: {
  assignments: GuardianAssignmentView[];
  friends: PublicCard[];
  minorGuests: GuestView[];
  viewerIsMinor: boolean;
}) {
  const router = useRouter();
  // Local copy so a mutation shows its server result immediately; a fresh server render replaces it.
  const [items, setItems] = React.useState(assignments);
  const [source, setSource] = React.useState(assignments);
  if (assignments !== source) {
    setSource(assignments);
    setItems(assignments);
  }
  const upsert = (next: GuardianAssignmentView) =>
    setItems((current) => [next, ...current.filter((item) => item.guardian_assignment_id !== next.guardian_assignment_id)]);
  const [showRevoked, setShowRevoked] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = React.useState<GuardianAssignmentView | null>(null);
  const [creating, setCreating] = React.useState(false);

  const awaitingMe = items.filter((a) => a.status === "PENDING" && a.awaiting_confirmation_by === "ME");
  const others = items.filter((a) => !awaitingMe.includes(a) && (showRevoked || a.status !== "REVOKED"));
  const revokedCount = items.filter((a) => a.status === "REVOKED").length;

  async function confirm(assignment: GuardianAssignmentView) {
    if (busy) return;
    setBusy(assignment.guardian_assignment_id);
    const result = await apiFetch<GuardianAssignmentView>(`/api/v1/me/guardians/${assignment.guardian_assignment_id}/confirm`, { method: "POST" });
    setBusy(null);
    if (!result.ok) {
      toast({ tone: "danger", title: "No se pudo confirmar.", description: guardianFailure(result) });
      return;
    }
    upsert(result.data);
    toast({ tone: "success", title: "Vinculación confirmada" });
    router.refresh();
  }

  function renderRow(assignment: GuardianAssignmentView, withConfirm: boolean) {
    const { title, detail } = describe(assignment);
    const open = assignment.status !== "REVOKED";
    return (
      <li key={assignment.guardian_assignment_id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between" data-testid="guardian-row">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-body font-semibold text-ink">{title}</p>
            <KindBadge kind={assignment.minor_kind === "GUEST" ? "GUEST" : "PROFILE"} />
          </div>
          <p className="mt-0.5 text-body-sm text-ink-60">
            {detail} · desde {formatCalendarDate(assignment.created_at.slice(0, 10))}
          </p>
          <div className="mt-2">{statusBadge(assignment)}</div>
        </div>
        {open ? (
          <div className="flex gap-2">
            {withConfirm ? (
              <Button size="sm" loading={busy === assignment.guardian_assignment_id} onClick={() => confirm(assignment)}>
                Confirmar
              </Button>
            ) : null}
            <Button size="sm" variant={withConfirm ? "secondary" : "ghost"} onClick={() => setRevokeTarget(assignment)}>
              {withConfirm ? "Rechazar" : "Revocar"}
            </Button>
          </div>
        ) : null}
      </li>
    );
  }

  return (
    <div className="flex flex-col gap-10">
      {awaitingMe.length > 0 ? (
        <AccountSection id="por-confirmar" title="Por confirmar" description="Revisa que conozcas a la persona antes de confirmar.">
          <RowList label="Vinculaciones por confirmar">{awaitingMe.map((a) => renderRow(a, true))}</RowList>
        </AccountSection>
      ) : null}

      <AccountSection
        id="vinculaciones"
        title="Vinculaciones"
        action={
          <Button onClick={() => setCreating(true)} className="w-full sm:w-auto">
            <Plus className="size-4" aria-hidden="true" />
            Nueva vinculación
          </Button>
        }
      >
        {others.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title="Sin vinculaciones"
            description={
              viewerIsMinor
                ? "Vincula a tu madre, padre o tutor para poder inscribirte."
                : "Vincula a los menores de 15 a 17 años que inscribes: tus invitados menores o las cuentas de tus amistades."
            }
            className="rounded-card border border-divider bg-paper-raised"
          />
        ) : (
          <RowList label="Vinculaciones">{others.map((a) => renderRow(a, false))}</RowList>
        )}
        {revokedCount > 0 ? (
          <div className="mt-4">
            <Checkbox id="show-revoked" checked={showRevoked} onCheckedChange={(value) => setShowRevoked(value === true)} label={`Mostrar revocadas (${revokedCount})`} />
          </div>
        ) : null}
      </AccountSection>

      <ConfirmDialog
        open={revokeTarget !== null}
        onOpenChange={(open) => !open && setRevokeTarget(null)}
        title={revokeTarget?.status === "PENDING" ? "¿Rechazar la vinculación?" : "¿Revocar la vinculación?"}
        description="El menor no podrá inscribirse con este adulto responsable. Para volver a vincularlos habrá que crear una nueva solicitud."
        confirmLabel={revokeTarget?.status === "PENDING" ? "Rechazar" : "Revocar"}
        onConfirm={async () => {
          if (!revokeTarget) return null;
          const result = await apiFetch<GuardianAssignmentView>(`/api/v1/me/guardians/${revokeTarget.guardian_assignment_id}`, { method: "DELETE" });
          if (!result.ok) return result;
          upsert(result.data);
          toast({ tone: "info", title: "Vinculación revocada" });
          router.refresh();
          return null;
        }}
        describeFailure={guardianFailure}
      />

      <NewAssignmentDialog
        open={creating}
        onOpenChange={setCreating}
        friends={friends}
        minorGuests={minorGuests}
        viewerIsMinor={viewerIsMinor}
        onCreated={(assignment) => {
          setCreating(false);
          upsert(assignment);
          router.refresh();
        }}
      />
    </div>
  );
}

function NewAssignmentDialog({
  open,
  onOpenChange,
  friends,
  minorGuests,
  viewerIsMinor,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  friends: PublicCard[];
  minorGuests: GuestView[];
  viewerIsMinor: boolean;
  onCreated: (assignment: GuardianAssignmentView) => void;
}) {
  const canGuest = !viewerIsMinor && minorGuests.length > 0;
  const [kind, setKind] = React.useState<"GUEST" | "RUNNER">(canGuest ? "GUEST" : "RUNNER");
  const [guestId, setGuestId] = React.useState("");
  const [guardian, setGuardian] = React.useState("ME");
  const [counterpart, setCounterpart] = React.useState("");
  const [relationship, setRelationship] = React.useState<"PARENT" | "LEGAL_GUARDIAN">("PARENT");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const returnFocus = useReturnFocus(open);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    const body =
      kind === "GUEST"
        ? { minor_kind: "GUEST", guest_participant_id: guestId, relationship_type: relationship, guardian_public_profile_id: guardian === "ME" ? null : guardian }
        : { minor_kind: "RUNNER", counterpart_public_profile_id: counterpart, relationship_type: relationship };
    if ((kind === "GUEST" && !guestId) || (kind === "RUNNER" && !counterpart)) {
      setError(kind === "GUEST" ? "Elige al invitado menor." : viewerIsMinor ? "Elige a tu adulto responsable." : "Elige a la persona menor de edad.");
      return;
    }
    setError(null);
    setPending(true);
    const result = await apiFetch<GuardianAssignmentView>("/api/v1/me/guardians", { method: "POST", body });
    setPending(false);
    if (!result.ok) {
      setError(guardianFailure(result));
      return;
    }
    toast({
      tone: "success",
      title: result.data.status === "ACTIVE" ? "Vinculación activa" : "Solicitud de vinculación enviada",
      description: result.data.status === "ACTIVE" ? undefined : "Queda pendiente hasta que la otra persona confirme.",
    });
    onCreated(result.data);
  }

  const noOptions = kind === "RUNNER" && friends.length === 0;

  return (
    <Modal open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <ModalContent
        onCloseAutoFocus={returnFocus}
        title="Nueva vinculación"
        description={viewerIsMinor ? "Elige al adulto que será responsable de ti en las carreras." : "Elige al menor y quién será su adulto responsable."}
      >
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          {error ? <Alert tone="danger" title={error} /> : null}
          {canGuest ? (
            <fieldset>
              <legend className="text-label font-semibold text-ink">¿A quién vas a vincular?</legend>
              <RadioGroup value={kind} onValueChange={(value) => setKind(value as "GUEST" | "RUNNER")} className="mt-1 flex flex-col">
                <RadioItem id="link-kind-guest" value="GUEST" label="Un invitado menor a mi cargo" />
                <RadioItem id="link-kind-runner" value="RUNNER" label="Una cuenta de RUNIIS (amistad)" />
              </RadioGroup>
            </fieldset>
          ) : null}

          {kind === "GUEST" ? (
            <>
              <FormField id="link-guest" label="Invitado menor" required>
                <Select value={guestId} onValueChange={setGuestId}>
                  <SelectTrigger id="link-guest" aria-required="true">
                    <SelectValue placeholder="Elige un invitado" />
                  </SelectTrigger>
                  <SelectContent>
                    {minorGuests.map((guest) => (
                      <SelectItem key={guest.guest_participant_id} value={guest.guest_participant_id}>
                        {guest.full_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <FormField id="link-guardian" label="Adulto responsable" required helperText="Si eliges a una amistad, deberá confirmar desde su cuenta.">
                <Select value={guardian} onValueChange={setGuardian}>
                  <SelectTrigger id="link-guardian" aria-describedby="link-guardian-helper">
                    <SelectValue>{guardian === "ME" ? "Yo" : friends.find((f) => f.public_profile_id === guardian)?.display_name}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ME">Yo</SelectItem>
                    {friends.map((friend) => (
                      <SelectItem key={friend.public_profile_id} value={friend.public_profile_id}>
                        {friend.display_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            </>
          ) : noOptions ? (
            <Alert tone="info" title="Primero agréguense como amistades">
              Para vincular una cuenta, esa persona debe ser tu amistad en RUNIIS. Búscala en Amigos.
            </Alert>
          ) : (
            <FormField
              id="link-counterpart"
              label={viewerIsMinor ? "Tu adulto responsable" : "Persona menor de edad"}
              required
              helperText="Deberá confirmar la vinculación desde su cuenta."
            >
              <Select value={counterpart} onValueChange={setCounterpart}>
                <SelectTrigger id="link-counterpart" aria-describedby="link-counterpart-helper" aria-required="true">
                  <SelectValue placeholder="Elige entre tus amistades" />
                </SelectTrigger>
                <SelectContent>
                  {friends.map((friend) => (
                    <SelectItem key={friend.public_profile_id} value={friend.public_profile_id}>
                      {friend.display_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          )}

          <fieldset>
            <legend className="text-label font-semibold text-ink">Relación</legend>
            <RadioGroup value={relationship} onValueChange={(value) => setRelationship(value as "PARENT" | "LEGAL_GUARDIAN")} className="mt-1 flex flex-wrap gap-x-6">
              <RadioItem id="link-rel-parent" value="PARENT" label={GUARDIAN_RELATIONSHIP_LABELS.PARENT} />
              <RadioItem id="link-rel-legal" value="LEGAL_GUARDIAN" label={GUARDIAN_RELATIONSHIP_LABELS.LEGAL_GUARDIAN} />
            </RadioGroup>
          </fieldset>

          <ModalActions>
            <ModalClose asChild>
              <Button variant="secondary" disabled={pending}>
                Cancelar
              </Button>
            </ModalClose>
            <Button type="submit" loading={pending} disabled={noOptions}>
              Vincular
            </Button>
          </ModalActions>
        </form>
      </ModalContent>
    </Modal>
  );
}
