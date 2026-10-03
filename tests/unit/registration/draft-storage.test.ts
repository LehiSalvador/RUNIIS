import { afterEach, describe, expect, test, vi } from "vitest";
import { clearAllDrafts, clearDraft, clearDraftsOfOtherAccounts, loadDraft, parseDraft, saveDraft, serializeDraft } from "@/components/registration/logic/draft-storage";
import type { Draft } from "@/components/registration/logic/model";
import { ID } from "./fixtures";

const draft: Draft = {
  selected: ["self", `guest:${ID.guest}`],
  participants: {
    self: { modalityId: ID.m10k, categoryId: ID.catLibre, responses: { shirt_size: "M", pace: "5", multi: ["a", "b"], ok: true }, accepted: [ID.waiver] },
    [`guest:${ID.guest}`]: { modalityId: ID.m5k, categoryId: null, responses: {}, accepted: [ID.waiver] },
  },
};

const ACCOUNT_A = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_B = "22222222-2222-4222-8222-222222222222";

afterEach(() => vi.unstubAllGlobals());

/** A Map-backed sessionStorage with the iteration surface (length/key) the purge needs. */
function stubSessionStorage(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
  vi.stubGlobal("window", {
    sessionStorage: {
      get length() {
        return store.size;
      },
      key: (index: number) => [...store.keys()][index] ?? null,
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
  });
  return store;
}

describe("session-expired resume draft (T12 J1 states)", () => {
  test("round trip keeps choices and answers but NEVER an accepted legal document", () => {
    const parsed = parseDraft(serializeDraft(draft))!;
    expect(parsed.selected).toEqual(draft.selected);
    expect(parsed.participants.self.modalityId).toBe(ID.m10k);
    expect(parsed.participants.self.responses).toEqual({ shirt_size: "M", pace: "5", multi: ["a", "b"], ok: true });
    expect(parsed.participants.self.accepted).toEqual([]);
    expect(serializeDraft(draft)).not.toContain(ID.waiver);
  });

  test("malformed or foreign payloads are ignored, never partially trusted", () => {
    expect(parseDraft(null)).toBeNull();
    expect(parseDraft("not json")).toBeNull();
    expect(parseDraft(JSON.stringify({ v: 99, selected: [], participants: {} }))).toBeNull();
    const dirty = parseDraft(JSON.stringify({ v: 1, selected: ["self", 5], participants: { self: { modalityId: 7, categoryId: "x", responses: { a: { nested: 1 }, b: "ok" } } } }))!;
    expect(dirty.selected).toEqual(["self"]);
    expect(dirty.participants.self).toEqual({ modalityId: null, categoryId: "x", responses: { b: "ok" }, accepted: [] });
  });

  test("storage blocked or throwing never breaks the flow", () => {
    const blocked = () => {
      throw new Error("blocked");
    };
    vi.stubGlobal("window", { sessionStorage: { getItem: blocked, setItem: blocked, removeItem: blocked } });
    expect(() => saveDraft(ACCOUNT_A, ID.edition, draft)).not.toThrow();
    expect(loadDraft(ACCOUNT_A, ID.edition)).toBeNull();
    expect(() => clearDraft(ACCOUNT_A, ID.edition)).not.toThrow();
  });

  test("saves, loads and clears through sessionStorage keyed by account and edition", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("window", {
      sessionStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) },
    });
    saveDraft(ACCOUNT_A, ID.edition, draft);
    expect([...store.keys()]).toEqual([`runiis:registration-draft:${ACCOUNT_A}:${ID.edition}`]);
    expect(loadDraft(ACCOUNT_A, ID.edition)?.selected).toEqual(draft.selected);
    clearDraft(ACCOUNT_A, ID.edition);
    expect(loadDraft(ACCOUNT_A, ID.edition)).toBeNull();
  });
});

describe("drafts never cross accounts (H2P2-03)", () => {
  test("a draft saved by one account is not restored for another account on the same edition", () => {
    stubSessionStorage();
    saveDraft(ACCOUNT_A, ID.edition, draft);
    expect(loadDraft(ACCOUNT_A, ID.edition)?.selected).toEqual(draft.selected);
    expect(loadDraft(ACCOUNT_B, ID.edition)).toBeNull();
  });

  test("without a known account nothing is read or written", () => {
    const store = stubSessionStorage();
    saveDraft(ACCOUNT_A, ID.edition, draft);
    for (const subject of [null, undefined, "", "a:b"]) {
      expect(loadDraft(subject, ID.edition)).toBeNull();
      saveDraft(subject, ID.edition, draft);
      clearDraft(subject, ID.edition);
    }
    expect([...store.keys()]).toEqual([`runiis:registration-draft:${ACCOUNT_A}:${ID.edition}`]);
  });

  test("signing in as another account purges every other draft, including the legacy edition-only key", () => {
    const store = stubSessionStorage({
      [`runiis:registration-draft:${ID.edition}`]: serializeDraft(draft),
      [`runiis:registration-draft:${ACCOUNT_A}:${ID.edition}`]: serializeDraft(draft),
      [`runiis:registration-draft:${ACCOUNT_B}:${ID.edition}`]: serializeDraft(draft),
      unrelated: "keep me",
    });
    clearDraftsOfOtherAccounts(ACCOUNT_B);
    expect([...store.keys()].sort()).toEqual([`runiis:registration-draft:${ACCOUNT_B}:${ID.edition}`, "unrelated"].sort());
    expect(loadDraft(ACCOUNT_A, ID.edition)).toBeNull();
    expect(loadDraft(ACCOUNT_B, ID.edition)?.selected).toEqual(draft.selected);
  });

  test("an unknown account purges nothing (fail safe: it cannot tell what is its own)", () => {
    const store = stubSessionStorage({ [`runiis:registration-draft:${ACCOUNT_A}:${ID.edition}`]: serializeDraft(draft) });
    clearDraftsOfOtherAccounts(null);
    expect(store.size).toBe(1);
  });

  test("clearAllDrafts removes every registration draft and only those; blocked storage never throws", () => {
    const store = stubSessionStorage({
      [`runiis:registration-draft:${ID.edition}`]: "legacy",
      [`runiis:registration-draft:${ACCOUNT_A}:${ID.edition}`]: serializeDraft(draft),
      [`runiis:registration-draft:${ACCOUNT_B}:other-edition`]: serializeDraft(draft),
      "runiis:something-else": "keep me",
    });
    clearAllDrafts();
    expect([...store.keys()]).toEqual(["runiis:something-else"]);
    vi.stubGlobal("window", {
      get sessionStorage(): Storage {
        throw new Error("blocked");
      },
    });
    expect(() => clearAllDrafts()).not.toThrow();
  });
});
