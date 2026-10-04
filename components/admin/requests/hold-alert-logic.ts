/**
 * Parsing of the hold-concentration alert (OD-P2-01, task `hold-concentration:{edition}`, P3-D and P3-R). The alert is a PROJECTION: the
 * task metadata may lack keys (older tasks) or carry new ones, so every key is read defensively and nothing is assumed. Nothing here
 * cancels anything: the alert only points staff at the requests to review.
 */
export type HoldTrigger = "NEW_ACCOUNT_SHARE" | "SINGLE_BUYER" | "TOTAL_HOLD_SHARE" | "MODALITY_HOLD_SHARE";

export const TRIGGER_TEXT: Record<HoldTrigger, string> = {
  NEW_ACCOUNT_SHARE: "Cuentas nuevas con apartados grandes retienen una parte alta de la capacidad.",
  SINGLE_BUYER: "Una sola cuenta retiene muchos lugares.",
  TOTAL_HOLD_SHARE: "Los apartados pendientes suman una parte alta de la capacidad de la edición.",
  MODALITY_HOLD_SHARE: "Una modalidad tiene gran parte de su cupo apartado.",
};

export type HoldAlert = {
  pendingPlaces: number | null;
  pendingRequests: number | null;
  topBuyerPlaces: number | null;
  capacity: number | null;
  triggers: HoldTrigger[];
  topRequests: { id: string; reference: string; places: number; newAccount: boolean }[];
  modalities: { id: string; name: string; capacity: number; pendingPlaces: number }[];
  reopenedAfterWaive: boolean;
};

export type AlertTask = {
  admin_task_id: string;
  title: string;
  description: string;
  detected_at: string;
  status: string;
  metadata: Record<string, unknown>;
};

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isTrigger(value: unknown): value is HoldTrigger {
  return typeof value === "string" && Object.hasOwn(TRIGGER_TEXT, value);
}

export function parseHoldAlert(metadata: Record<string, unknown>): HoldAlert {
  const triggers = Array.isArray(metadata.triggers) ? metadata.triggers.filter(isTrigger) : [];
  const topRequests = Array.isArray(metadata.top_requests)
    ? metadata.top_requests.flatMap((raw) => {
        if (!raw || typeof raw !== "object") return [];
        const row = raw as Record<string, unknown>;
        const places = num(row.places);
        if (typeof row.registration_request_id !== "string" || typeof row.public_reference !== "string" || places === null) return [];
        return [{ id: row.registration_request_id, reference: row.public_reference, places, newAccount: row.new_account === true }];
      })
    : [];
  const modalities = Array.isArray(metadata.modalities_over_threshold)
    ? metadata.modalities_over_threshold.flatMap((raw) => {
        if (!raw || typeof raw !== "object") return [];
        const row = raw as Record<string, unknown>;
        const capacity = num(row.capacity);
        const pending = num(row.pending_places);
        if (typeof row.modality_id !== "string" || typeof row.name !== "string" || capacity === null || pending === null) return [];
        return [{ id: row.modality_id, name: row.name, capacity, pendingPlaces: pending }];
      })
    : [];
  return {
    pendingPlaces: num(metadata.pending_places),
    pendingRequests: num(metadata.pending_requests),
    topBuyerPlaces: num(metadata.top_buyer_places),
    capacity: num(metadata.capacity),
    triggers,
    topRequests,
    modalities,
    reopenedAfterWaive: typeof metadata.reopened_after_waive === "object" && metadata.reopened_after_waive !== null,
  };
}

/** "37 % de la capacidad" from places held and the Edition capacity; null when either is unknown. */
export function shareOfCapacity(alert: Pick<HoldAlert, "pendingPlaces" | "capacity">): number | null {
  if (alert.pendingPlaces === null || alert.capacity === null || alert.capacity <= 0) return null;
  return Math.round((alert.pendingPlaces * 1000) / alert.capacity) / 10;
}

/** Link to the queue filtered to the pending requests, or to one reference, in the same Edition. */
export function queueHref(editionId: string, params: { status?: string; search?: string } = {}): string {
  const query = new URLSearchParams();
  if (params.status) query.set("status", params.status);
  if (params.search) query.set("search", params.search);
  const text = query.toString();
  return `/admin/eventos/${editionId}/solicitudes${text ? `?${text}` : ""}`;
}
