import { emptyParticipantDraft, type Draft, type FieldValue, type ParticipantDraft } from "./model";

// Per-tab convenience so a session that expires mid-flow can resume after re-authentication (T12 J1 states:
// session-expired -> /entrar). It stores only what the person typed or chose. It never stores accepted legal
// documents: an acceptance is an explicit act each time, never restored on someone's behalf. Every access is
// guarded: storage can be blocked, full or absent and the flow must work without it.

const PREFIX = "runiis:registration-draft:";
const VERSION = 1;

function storageKey(editionId: string): string {
  return `${PREFIX}${editionId}`;
}

function sessionStore(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function isFieldValue(value: unknown): value is FieldValue {
  return typeof value === "string" || typeof value === "boolean" || (Array.isArray(value) && value.every((item) => typeof item === "string"));
}

/** Pure: the persisted form of a draft (no acceptances). */
export function serializeDraft(draft: Draft): string {
  const participants: Record<string, Omit<ParticipantDraft, "accepted">> = {};
  for (const key of draft.selected) {
    const { modalityId, categoryId, responses } = draft.participants[key] ?? emptyParticipantDraft();
    participants[key] = { modalityId, categoryId, responses };
  }
  return JSON.stringify({ v: VERSION, selected: draft.selected, participants });
}

/** Pure: tolerant parse. Anything malformed yields null (never throws, never partially trusts). */
export function parseDraft(raw: string | null): Draft | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { v?: unknown; selected?: unknown; participants?: unknown };
    if (parsed.v !== VERSION || !Array.isArray(parsed.selected) || !parsed.participants || typeof parsed.participants !== "object") return null;
    const selected = parsed.selected.filter((key): key is string => typeof key === "string").slice(0, 100);
    const participants: Record<string, ParticipantDraft> = {};
    for (const key of selected) {
      const source = (parsed.participants as Record<string, unknown>)[key];
      if (!source || typeof source !== "object") continue;
      const { modalityId, categoryId, responses } = source as { modalityId?: unknown; categoryId?: unknown; responses?: unknown };
      const clean: Record<string, FieldValue> = {};
      if (responses && typeof responses === "object") {
        for (const [field, value] of Object.entries(responses as Record<string, unknown>)) if (isFieldValue(value)) clean[field] = value;
      }
      participants[key] = {
        modalityId: typeof modalityId === "string" ? modalityId : null,
        categoryId: typeof categoryId === "string" ? categoryId : null,
        responses: clean,
        accepted: [],
      };
    }
    return { selected, participants };
  } catch {
    return null;
  }
}

export function saveDraft(editionId: string, draft: Draft): void {
  try {
    sessionStore()?.setItem(storageKey(editionId), serializeDraft(draft));
  } catch {
    // Storage unavailable: the flow keeps working from memory.
  }
}

export function loadDraft(editionId: string): Draft | null {
  try {
    return parseDraft(sessionStore()?.getItem(storageKey(editionId)) ?? null);
  } catch {
    return null;
  }
}

export function clearDraft(editionId: string): void {
  try {
    sessionStore()?.removeItem(storageKey(editionId));
  } catch {
    // Nothing to clear.
  }
}
