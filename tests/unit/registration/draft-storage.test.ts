import { afterEach, describe, expect, test, vi } from "vitest";
import { clearDraft, loadDraft, parseDraft, saveDraft, serializeDraft } from "@/components/registration/logic/draft-storage";
import type { Draft } from "@/components/registration/logic/model";
import { ID } from "./fixtures";

const draft: Draft = {
  selected: ["self", `guest:${ID.guest}`],
  participants: {
    self: { modalityId: ID.m10k, categoryId: ID.catLibre, responses: { shirt_size: "M", pace: "5", multi: ["a", "b"], ok: true }, accepted: [ID.waiver] },
    [`guest:${ID.guest}`]: { modalityId: ID.m5k, categoryId: null, responses: {}, accepted: [ID.waiver] },
  },
};

afterEach(() => vi.unstubAllGlobals());

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
    expect(() => saveDraft(ID.edition, draft)).not.toThrow();
    expect(loadDraft(ID.edition)).toBeNull();
    expect(() => clearDraft(ID.edition)).not.toThrow();
  });

  test("saves, loads and clears through sessionStorage keyed by edition", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("window", {
      sessionStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) },
    });
    saveDraft(ID.edition, draft);
    expect([...store.keys()]).toEqual([`runiis:registration-draft:${ID.edition}`]);
    expect(loadDraft(ID.edition)?.selected).toEqual(draft.selected);
    clearDraft(ID.edition);
    expect(loadDraft(ID.edition)).toBeNull();
  });
});
