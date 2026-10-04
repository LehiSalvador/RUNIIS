"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { KeyRound, PackageCheck, Undo2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { toast } from "@/components/ui/use-toast";
import { apiFetch, type ApiResult } from "@/lib/client/api";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { Panel } from "@/components/admin/panel";
import { AdminBadge } from "@/components/admin/status-badges";
import { CheckField, SelectField, TextareaField } from "@/components/admin/events/fields";
import { FormDialog } from "@/components/admin/events/form-dialog";
import { KIT_STATUS_LABEL, validateReason } from "@/components/admin/raceday/kit-logic";
import { OUTCOME_SPEC, isScanOutcome } from "@/components/scanner/outcomes";

/**
 * Kit Center, in-person half: find a participant and hand over the kit, replace a lost or compromised QR, reverse a delivery. All
 * three go through the existing commands; the screen never shows a delivery as done before the server answers `outcome: VALID`
 * (a pickup answers 200 with one of the 11 outcomes, so "ok" alone is not "delivered").
 */
export type KitParticipant = {
  registration_id: string;
  registration_number: string;
  full_name: string | null;
  modality: { name: string };
  is_minor: boolean;
  pass: { participant_pass_id: string; public_code: string; status: string; has_active_credential: boolean } | null;
  kit: { status: string; kit_variant_id: string; variant_label: string } | null;
};

export type ActiveKit = { kit_definition_id: string; name: string };

type Delivery = { kit_pickup_id: string; name: string; registration_number: string; kit: string };

const KIT_TONE: Record<string, "success" | "info" | "warning" | "neutral"> = {
  DELIVERED: "success",
  READY: "info",
  ASSIGNED: "neutral",
  EXCEPTION: "warning",
  CANCELED: "neutral",
};

export function KitParticipants({
  rows,
  editionId,
  activeKits,
  locked,
}: {
  rows: KitParticipant[];
  editionId: string;
  activeKits: readonly ActiveKit[];
  locked: boolean;
}) {
  const [pickup, setPickup] = React.useState<KitParticipant | null>(null);
  const [replace, setReplace] = React.useState<KitParticipant | null>(null);
  const [reverse, setReverse] = React.useState<Delivery | null>(null);
  const [deliveries, setDeliveries] = React.useState<Delivery[]>([]);
  const router = useRouter();

  const columns = React.useMemo<DataTableColumn<KitParticipant>[]>(
    () => [
      {
        key: "name",
        header: "Participante",
        priority: 1,
        render: (row) => (
          <div className="min-w-0">
            <p className="font-semibold text-ink">{row.full_name ?? "Sin nombre"}</p>
            <p className="text-caption text-ink-60">
              Inscripción {row.registration_number}
              {row.is_minor ? " · Menor de edad" : ""}
            </p>
          </div>
        ),
      },
      { key: "modality", header: "Modalidad", priority: 3, render: (row) => row.modality.name },
      {
        key: "kit",
        header: "Kit",
        priority: 2,
        render: (row) =>
          row.kit ? (
            <div className="flex flex-wrap items-center gap-2">
              <AdminBadge icon={PackageCheck} tone={KIT_TONE[row.kit.status] ?? "neutral"}>
                {KIT_STATUS_LABEL[row.kit.status] ?? row.kit.status}
              </AdminBadge>
              <span className="text-caption text-ink-60">{row.kit.variant_label}</span>
            </div>
          ) : (
            <span className="text-body-sm text-ink-60">Sin kit asignado</span>
          ),
      },
      { key: "pass", header: "Pase", priority: 4, render: (row) => (row.pass ? `${row.pass.public_code} · ${row.pass.status === "ACTIVE" ? "Activo" : row.pass.status}` : "Sin pase") },
    ],
    [],
  );

  return (
    <Panel title="Participantes y entrega" description="Busca a una persona para entregarle el kit sin QR, o reemplazar su QR. Solo se listan inscripciones confirmadas.">
      <div className="flex flex-col gap-4">
        <DataTable
          caption="Participantes con su kit"
          columns={columns}
          rows={rows}
          getRowId={(row) => row.registration_id}
          getRowLabel={(row) => row.full_name ?? row.registration_number}
          keepColumnsBelowLg={3}
          keepColumnsBelowMd={2}
          emptyState={{ icon: Users, title: "No hay participantes con estos filtros", description: "Cambia la búsqueda o limpia los filtros.", headingLevel: "h3" }}
          rowActions={(row) => (
            <div className="flex flex-wrap justify-end gap-1">
              {!locked && row.kit && (row.kit.status === "ASSIGNED" || row.kit.status === "READY") ? (
                <Button size="sm" onClick={() => setPickup(row)}>
                  <PackageCheck className="size-4" aria-hidden="true" />
                  Entregar kit<span className="sr-only"> a {row.full_name ?? row.registration_number}</span>
                </Button>
              ) : null}
              {!locked && row.pass && row.pass.status === "ACTIVE" ? (
                <Button size="sm" variant="secondary" onClick={() => setReplace(row)}>
                  <KeyRound className="size-4" aria-hidden="true" />
                  Reemplazar QR<span className="sr-only"> de {row.full_name ?? row.registration_number}</span>
                </Button>
              ) : null}
            </div>
          )}
        />

        {deliveries.length > 0 ? (
          <section aria-label="Entregas hechas en esta pantalla" data-testid="session-deliveries">
            <h3 className="text-body font-bold text-ink">Entregas hechas en esta pantalla</h3>
            <p className="mb-2 text-caption text-ink-60">Puedes revertir una entrega solo desde aquí y mientras no recargues la página: el servidor identifica la entrega por el comprobante que acaba de devolver.</p>
            <ul className="divide-y divide-divider rounded-card border border-divider">
              {deliveries.map((delivery) => (
                <li key={delivery.kit_pickup_id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                  <span className="text-body-sm">
                    <span className="font-semibold text-ink">{delivery.name}</span> · inscripción {delivery.registration_number} · {delivery.kit}
                  </span>
                  <Button size="sm" variant="secondary" onClick={() => setReverse(delivery)}>
                    <Undo2 className="size-4" aria-hidden="true" />
                    Revertir entrega<span className="sr-only"> de {delivery.name}</span>
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>

      {pickup ? (
        <PickupDialog
          key={pickup.registration_id}
          editionId={editionId}
          participant={pickup}
          kits={activeKits}
          onDelivered={(delivery) => setDeliveries((current) => [delivery, ...current])}
          onClose={() => setPickup(null)}
        />
      ) : null}

      <ConfirmDialog
        open={replace !== null}
        onOpenChange={(open) => !open && setReplace(null)}
        title={`Reemplazar el QR de ${replace?.full_name ?? replace?.registration_number ?? ""}`}
        description="El QR anterior deja de funcionar de inmediato y se emite uno nuevo, que la persona verá en su cuenta. Úsalo si lo perdió o se compartió."
        confirmLabel="Reemplazar QR"
        tone="danger"
        reason={{ label: "Motivo", required: true, minLength: 3, helper: "Queda registrado en la auditoría." }}
        onConfirm={({ reason, idempotencyKey }) =>
          apiFetch(`/api/v1/admin/passes/${replace!.pass!.participant_pass_id}/replace-credential`, { method: "POST", body: { reason }, idempotencyKey })
        }
        onDone={() => {
          toast({ tone: "success", title: "QR reemplazado" });
          router.refresh();
        }}
      />

      <ConfirmDialog
        open={reverse !== null}
        onOpenChange={(open) => !open && setReverse(null)}
        title={`Revertir la entrega de ${reverse?.name ?? ""}`}
        description="El kit vuelve a quedar asignado y por entregar. Escribe por qué se revierte."
        confirmLabel="Revertir entrega"
        tone="danger"
        reason={{ label: "Motivo", required: true, minLength: 3 }}
        onConfirm={({ reason, idempotencyKey }) => apiFetch(`/api/v1/admin/kits/pickup/${reverse!.kit_pickup_id}/reverse`, { method: "POST", body: { reason }, idempotencyKey })}
        onDone={() => {
          const undone = reverse;
          setDeliveries((current) => current.filter((item) => item.kit_pickup_id !== undone?.kit_pickup_id));
          toast({ tone: "success", title: "Entrega revertida" });
          router.refresh();
        }}
      />
    </Panel>
  );
}

// ---- Pickup ------------------------------------------------------------------------------------------------------------------

function PickupDialog({
  editionId,
  participant,
  kits,
  onDelivered,
  onClose,
}: {
  editionId: string;
  participant: KitParticipant;
  kits: readonly ActiveKit[];
  onDelivered: (delivery: Delivery) => void;
  onClose: () => void;
}) {
  const [kitId, setKitId] = React.useState(kits.length === 1 ? kits[0].kit_definition_id : "");
  const [thirdParty, setThirdParty] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [errors, setErrors] = React.useState<{ kit?: string; reason?: string }>({});
  const [notice, setNotice] = React.useState<string | null>(null);

  async function onSubmit({ idempotencyKey }: { idempotencyKey: string }): Promise<ApiResult<unknown> | null> {
    const found: { kit?: string; reason?: string } = {};
    if (!kitId) found.kit = "Elige el kit que se entrega.";
    if (thirdParty) found.reason = validateReason(reason, "Quién lo recoge y por qué");
    setErrors(found);
    setNotice(null);
    if (found.kit || found.reason) return null;

    const result = await apiFetch<{ outcome?: unknown; kit_pickup_id?: string | null }>("/api/v1/admin/kits/pickup", {
      method: "POST",
      idempotencyKey,
      body: {
        edition_id: editionId,
        kit_definition_id: kitId,
        registration_id: participant.registration_id,
        ...(thirdParty ? { third_party: true, third_party_reason: reason.trim() } : {}),
      },
    });
    if (!result.ok) return result;

    const outcome = result.data.outcome;
    if (outcome === "VALID") {
      if (result.data.kit_pickup_id) {
        onDelivered({
          kit_pickup_id: result.data.kit_pickup_id,
          name: participant.full_name ?? participant.registration_number,
          registration_number: participant.registration_number,
          kit: kits.find((kit) => kit.kit_definition_id === kitId)?.name ?? "Kit",
        });
      }
      return result;
    }
    // A 200 whose outcome is not VALID means nothing was delivered: show why, keep the dialog open.
    setNotice(isScanOutcome(outcome) ? `${OUTCOME_SPEC[outcome].label}. ${OUTCOME_SPEC[outcome].action}` : "El servidor respondió algo inesperado y no se entregó nada. Actualiza la pantalla y vuelve a intentar.");
    return null;
  }

  return (
    <FormDialog
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={`Entregar kit a ${participant.full_name ?? participant.registration_number}`}
      description={`Inscripción ${participant.registration_number}${participant.kit ? ` · talla ${participant.kit.variant_label}` : ""}. Se verifica en el servidor antes de marcarlo como entregado.`}
      submitLabel="Entregar kit"
      successMessage="Kit entregado"
      onSubmit={onSubmit}
    >
      {kits.length === 0 ? (
        <p role="alert" className="text-body-sm text-danger">
          No hay kits activos para entregar. Activa uno en esta pantalla primero.
        </p>
      ) : (
        <SelectField
          id="pickup-kit"
          label="Kit"
          required
          value={kitId}
          error={errors.kit}
          options={[{ value: "", label: "Elige un kit" }, ...kits.map((kit) => ({ value: kit.kit_definition_id, label: kit.name }))]}
          onChange={(event) => setKitId(event.target.value)}
        />
      )}
      <CheckField id="pickup-third" label="Lo recoge otra persona" helperText="Debes anotar quién lo recoge y por qué: queda registrado." checked={thirdParty} onChange={setThirdParty} />
      {thirdParty ? (
        <TextareaField id="pickup-reason" label="Quién lo recoge y por qué" required value={reason} error={errors.reason} maxLength={500} onChange={(event) => setReason(event.target.value)} />
      ) : null}
      {notice ? (
        <p role="alert" className="rounded-control border border-warning-border bg-warning-tint px-3 py-2 text-body-sm text-ink" data-testid="pickup-notice">
          {notice}
        </p>
      ) : null}
    </FormDialog>
  );
}
