import type { ScanOperation } from "@/components/scanner/outcomes";

/**
 * Scanner session (T12 J4 step 1, T13 §3.6 "session-setup-incomplete"): Edition + station + operation type are chosen once and fixed
 * before the camera ever opens. Pure and client-safe; nothing in a session is a secret (no token, no QR, no personal data), so it
 * may live in sessionStorage to survive an accidental reload of the tab.
 */
export type ScanSession = {
  editionId: string;
  editionName: string;
  /** Free label of the physical station ("Entrada 1"), sent as station_key (the API caps it at 100 characters). */
  station: string;
  operation: ScanOperation;
  /** KIT_PICKUP only: the kit this desk hands out. */
  kitDefinitionId: string | null;
  kitName: string | null;
};

export type SessionDraft = {
  editionId: string;
  station: string;
  operation: ScanOperation | "";
  kitDefinitionId: string;
};

export type SessionErrors = Partial<Record<keyof SessionDraft, string>>;

export const STATION_MAX = 100;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Control characters have no place in a station label.
const CONTROL = /[\u0000-\u001f\u007f]/;

export function validateSessionDraft(draft: SessionDraft, editionIds: readonly string[]): SessionErrors {
  const errors: SessionErrors = {};
  if (!draft.editionId) errors.editionId = "Elige la edición.";
  else if (!GUID.test(draft.editionId) || !editionIds.includes(draft.editionId)) errors.editionId = "Esa edición no está disponible para ti.";

  const station = draft.station.trim();
  if (station.length === 0) errors.station = "Escribe el nombre de la estación, por ejemplo «Entrada 1».";
  else if (station.length > STATION_MAX) errors.station = `Máximo ${STATION_MAX} caracteres.`;
  else if (CONTROL.test(station)) errors.station = "Usa solo letras, números y signos normales.";

  if (draft.operation === "") errors.operation = "Elige qué vas a hacer en esta estación.";
  else if (draft.operation === "KIT_PICKUP" && !draft.kitDefinitionId) errors.kitDefinitionId = "Elige el kit que entregas.";
  return errors;
}

export function hasErrors(errors: SessionErrors): boolean {
  return Object.values(errors).some(Boolean);
}

const STORAGE_KEY = "runiis.scanner.session";

export function readStoredDraft(storage: Pick<Storage, "getItem"> | null): Partial<SessionDraft> {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const value = parsed as Record<string, unknown>;
    const draft: Partial<SessionDraft> = {};
    if (typeof value.editionId === "string") draft.editionId = value.editionId;
    if (typeof value.station === "string") draft.station = value.station.slice(0, STATION_MAX);
    if (value.operation === "EVENT_CHECKIN" || value.operation === "KIT_PICKUP") draft.operation = value.operation;
    if (typeof value.kitDefinitionId === "string") draft.kitDefinitionId = value.kitDefinitionId;
    return draft;
  } catch {
    return {};
  }
}

export function storeDraft(storage: Pick<Storage, "setItem"> | null, draft: SessionDraft): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // Storage can be blocked (private window); the session simply is not remembered.
  }
}

export function sessionStorageOrNull(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** A kit this desk can hand out: ACTIVE definitions whose pickup window has not closed. */
export type KitChoice = { kit_definition_id: string; name: string; status: string; pickup_start_at: string | null; pickup_end_at: string | null };

export function selectableKits(kits: readonly KitChoice[]): KitChoice[] {
  return kits.filter((kit) => kit.status === "ACTIVE");
}
