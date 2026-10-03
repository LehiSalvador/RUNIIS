import { emptyParticipantDraft, type Draft, type FieldValue, type ParticipantDraft } from "./model";

// Per-tab convenience so a session that expires mid-flow can resume after re-authentication (T12 J1 states:
// session-expired -> /entrar). It stores only what the person typed or chose. It never stores accepted legal
// documents: an acceptance is an explicit act each time, never restored on someone's behalf. Every access is
// guarded: storage can be blocked, full or absent and the flow must work without it.
//
// A draft belongs to ONE account (H2P2-03): the key is `<prefix><subject>:<edition>`, where the subject is the opaque
// runner_profile_id (a random UUID, not PII). Without a subject nothing is read or written, so answers typed by one
// account can never be restored for the next one in the same tab. Every draft is cleared on sign-out and, when the
// flow loads for another account, every draft that is not that account's is purged (legacy edition-only keys too).

const PREFIX = "runiis:registration-draft:";
const VERSION = 1;

/** A subject is an opaque, non-empty id without the key separator; anything else means "no account known". */
function usableSubject(subject: string | null | undefined): subject is string {
  return typeof subject === "string" && subject.length > 0 && subject.length <= 64 && !subject.includes(":");
}

function storageKey(subject: string, editionId: string): string {
  return `${PREFIX}${subject}:${editionId}`;
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

export function saveDraft(subject: string | null | undefined, editionId: string, draft: Draft): void {
  if (!usableSubject(subject)) return;
  try {
    sessionStore()?.setItem(storageKey(subject, editionId), serializeDraft(draft));
  } catch {
    // Storage unavailable: the flow keeps working from memory.
  }
}

export function loadDraft(subject: string | null | undefined, editionId: string): Draft | null {
  if (!usableSubject(subject)) return null;
  try {
    return parseDraft(sessionStore()?.getItem(storageKey(subject, editionId)) ?? null);
  } catch {
    return null;
  }
}

export function clearDraft(subject: string | null | undefined, editionId: string): void {
  if (!usableSubject(subject)) return;
  try {
    sessionStore()?.removeItem(storageKey(subject, editionId));
  } catch {
    // Nothing to clear.
  }
}

function removeDraftKeys(keep: (key: string) => boolean): void {
  try {
    const store = sessionStore();
    if (!store) return;
    const doomed: string[] = [];
    for (let index = 0; index < store.length; index++) {
      const key = store.key(index);
      if (key !== null && key.startsWith(PREFIX) && !keep(key)) doomed.push(key);
    }
    for (const key of doomed) store.removeItem(key);
  } catch {
    // Nothing to clear.
  }
}

/** Sign-out: no registration draft of any account (or of the legacy edition-only form) outlives the session. */
export function clearAllDrafts(): void {
  removeDraftKeys(() => false);
}

/** The signed-in account changed (or is being confirmed): drop every draft that is not this account's. */
export function clearDraftsOfOtherAccounts(subject: string | null | undefined): void {
  if (!usableSubject(subject)) return;
  const own = `${PREFIX}${subject}:`;
  removeDraftKeys((key) => key.startsWith(own));
}
