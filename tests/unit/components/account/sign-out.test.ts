import { afterEach, describe, expect, test, vi } from "vitest";
import { endSession } from "@/components/account/sign-out-button";
import { serializeDraft } from "@/components/registration/logic/draft-storage";
import type { ApiFailure, ApiResult } from "@/lib/client/api";
import { baseContext } from "../../registration/fixtures";
import { initialDraft } from "@/components/registration/logic/model";

afterEach(() => vi.unstubAllGlobals());

const DRAFT_KEY = "runiis:registration-draft:11111111-1111-4111-8111-111111111111:edition-1";

function stubStore() {
  const store = new Map<string, string>([[DRAFT_KEY, serializeDraft(initialDraft(baseContext()))]]);
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

const failure = (code: ApiFailure["code"], status = 500): ApiFailure => ({ ok: false, status, code, message: "", requestId: null, details: {} });
const success: ApiResult<unknown> = { ok: true, status: 200, data: {}, meta: {} };

describe("sign-out clears the registration drafts (H2P2-03)", () => {
  test("a completed sign-out removes every draft of the tab", async () => {
    const store = stubStore();
    expect(await endSession(async () => success)).toBeNull();
    expect(store.size).toBe(0);
  });

  test("an already-expired session counts as signed out and clears the drafts too", async () => {
    const store = stubStore();
    expect(await endSession(async () => failure("AUTH_REQUIRED", 401))).toBeNull();
    expect(store.size).toBe(0);
  });

  test("a failed sign-out keeps the drafts (the person is still signed in) and reports the failure", async () => {
    const store = stubStore();
    const result = await endSession(async () => failure("NETWORK_ERROR"));
    expect(result?.code).toBe("NETWORK_ERROR");
    expect(store.size).toBe(1);
  });
});
