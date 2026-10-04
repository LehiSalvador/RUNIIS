import { describe, expect, test } from "vitest";
import { hasErrors, readStoredDraft, selectableKits, storeDraft, validateSessionDraft, type SessionDraft } from "@/components/scanner/session";

const ED = "50000000-0000-4000-8000-000000000001";
const draft = (over: Partial<SessionDraft> = {}): SessionDraft => ({ editionId: ED, station: "Entrada 1", operation: "EVENT_CHECKIN", kitDefinitionId: "", ...over });

describe("scanner session setup (T13 session-setup-incomplete)", () => {
  test("an empty draft is blocked on all three fields", () => {
    const errors = validateSessionDraft({ editionId: "", station: "", operation: "", kitDefinitionId: "" }, [ED]);
    expect(errors.editionId).toBeTruthy();
    expect(errors.station).toBeTruthy();
    expect(errors.operation).toBeTruthy();
    expect(hasErrors(errors)).toBe(true);
  });

  test("a complete check-in session passes; a kit session also needs the kit", () => {
    expect(hasErrors(validateSessionDraft(draft(), [ED]))).toBe(false);
    expect(validateSessionDraft(draft({ operation: "KIT_PICKUP" }), [ED]).kitDefinitionId).toBeTruthy();
    expect(hasErrors(validateSessionDraft(draft({ operation: "KIT_PICKUP", kitDefinitionId: "k1" }), [ED]))).toBe(false);
  });

  test("only an Edition offered to the person can be chosen, and the station label is bounded and clean", () => {
    expect(validateSessionDraft(draft({ editionId: "50000000-0000-4000-8000-0000000000ff" }), [ED]).editionId).toBeTruthy();
    expect(validateSessionDraft(draft({ editionId: "not-a-uuid" }), [ED]).editionId).toBeTruthy();
    expect(validateSessionDraft(draft({ station: "x".repeat(101) }), [ED]).station).toBeTruthy();
    expect(validateSessionDraft(draft({ station: "Puerta\u0007" }), [ED]).station).toBeTruthy();
    expect(validateSessionDraft(draft({ station: "   " }), [ED]).station).toBeTruthy();
  });

  test("the remembered draft holds no secret and survives a blocked or corrupt storage", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    storeDraft(storage, draft());
    expect(JSON.stringify([...store.values()])).not.toMatch(/RN1|token/i);
    expect(readStoredDraft(storage)).toMatchObject({ editionId: ED, station: "Entrada 1", operation: "EVENT_CHECKIN" });
    expect(readStoredDraft({ getItem: () => "{broken" })).toEqual({});
    expect(
      readStoredDraft({
        getItem: () => {
          throw new Error("blocked");
        },
      }),
    ).toEqual({});
    expect(readStoredDraft(null)).toEqual({});
    expect(() =>
      storeDraft(
        {
          setItem: () => {
            throw new Error("blocked");
          },
        },
        draft(),
      ),
    ).not.toThrow();
  });

  test("only ACTIVE kits are offered at a kit desk", () => {
    const kits = [
      { kit_definition_id: "a", name: "A", status: "ACTIVE", pickup_start_at: null, pickup_end_at: null },
      { kit_definition_id: "b", name: "B", status: "INACTIVE", pickup_start_at: null, pickup_end_at: null },
    ];
    expect(selectableKits(kits).map((kit) => kit.kit_definition_id)).toEqual(["a"]);
  });
});
