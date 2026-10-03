import { describe, expect, test } from "vitest";
import { documentKeyFor, loadActionDocumentTexts, loadEditionDocumentKeys, type LegalText } from "@/components/account/logic/pending-action-documents";
import type { ApiResult } from "@/lib/client/api";
import type { PendingActionView } from "@/lib/client/account-types";
import { ID, WAIVER_DOC } from "../registration/fixtures";

// P2-AC-03.g: the /cuenta pending-action dialog reads each document's text by the key of THAT document, which for the Edition's
// rules is a per-Edition key only the registration context lists.

const RULES_ID = "64000000-0000-4000-8000-0000000c0009";
const RULES_KEY = "EVENT_RULES_50000000000040008000000000000C01";
const RULES_DOC = { document_type: "EVENT_RULES", document_key: RULES_KEY, applies_to: "ALL", legal_document_version_id: RULES_ID, version: 2, published_at: "2026-09-01T12:00:00+00:00" } as const;

const action: Pick<PendingActionView, "edition" | "documents"> = {
  edition: { edition_id: ID.edition, name: "Demo Gratis 5K/10K", slug: "demo-gratis" },
  documents: [
    { legal_document_version_id: ID.waiver, document_type: "SPORT_WAIVER", version: 3 },
    { legal_document_version_id: RULES_ID, document_type: "EVENT_RULES", version: 2 },
  ],
};

const ok = <T,>(data: T): ApiResult<T> => ({ ok: true, status: 200, data, meta: {} });
const failure = (status: number, code = "NOT_FOUND"): ApiResult<never> => ({ ok: false, status, code: code as "NOT_FOUND", message: "", requestId: null, details: {} });

/** Fake of apiFetch: answers the registration context and each public legal text, recording every path asked. */
function fakeApi(options: { context?: ApiResult<unknown>; texts: Record<string, ApiResult<unknown>> }) {
  const calls: string[] = [];
  const fetcher = (async (path: string) => {
    calls.push(path);
    if (path.endsWith("/registration-context")) return options.context ?? ok({ documents: [WAIVER_DOC, RULES_DOC] });
    const key = decodeURIComponent(path.replace("/api/v1/legal/", ""));
    return options.texts[key] ?? failure(404);
  }) as Parameters<typeof loadActionDocumentTexts>[1];
  return { calls, fetcher };
}

async function run(api: ReturnType<typeof fakeApi>) {
  const texts: Record<string, LegalText> = {};
  await loadActionDocumentTexts(action, api.fetcher, (id, text) => (texts[id] = text));
  return texts;
}

describe("P2-AC-03.g per-edition document text by key", () => {
  test("the Edition's rules are read by their per-Edition key, platform documents by their own", async () => {
    const api = fakeApi({
      texts: {
        SPORT_WAIVER: ok({ legal_document_version_id: ID.waiver, content_markdown: "# Deslinde" }),
        [RULES_KEY]: ok({ legal_document_version_id: RULES_ID, content_markdown: "# Reglas del evento" }),
      },
    });
    const texts = await run(api);
    expect(texts[ID.waiver]).toEqual({ status: "ready", markdown: "# Deslinde" });
    expect(texts[RULES_ID]).toEqual({ status: "ready", markdown: "# Reglas del evento" });
    expect(api.calls).toContain("/api/v1/events/demo-gratis/registration-context");
    expect(api.calls).toContain(`/api/v1/legal/${RULES_KEY}`);
    expect(api.calls).not.toContain("/api/v1/legal/EVENT_RULES");
  });

  test("safe fallback: when the context cannot be read the type is the key, and a missing text is 'unavailable', never an error", async () => {
    const api = fakeApi({
      context: failure(500, "INTERNAL_ERROR"),
      texts: { SPORT_WAIVER: ok({ legal_document_version_id: ID.waiver, content_markdown: "# Deslinde" }) },
    });
    const texts = await run(api);
    expect(texts[ID.waiver].status).toBe("ready");
    expect(texts[RULES_ID]).toEqual({ status: "unavailable" });
    expect(api.calls).toContain("/api/v1/legal/EVENT_RULES");
  });

  test("a text of another version than the one about to be accepted, or published as a file, is not shown", async () => {
    const api = fakeApi({
      texts: {
        SPORT_WAIVER: ok({ legal_document_version_id: "64000000-0000-4000-8000-00000000ffff", content_markdown: "# Otra versión" }),
        [RULES_KEY]: ok({ legal_document_version_id: RULES_ID, content_markdown: null }),
      },
    });
    expect(await run(api)).toEqual({ [ID.waiver]: { status: "unavailable" }, [RULES_ID]: { status: "unavailable" } });
  });

  test("documentKeyFor / loadEditionDocumentKeys: key by version id, type when unlisted, [] on a failed or malformed context", async () => {
    expect(documentKeyFor(action.documents[1], [WAIVER_DOC, RULES_DOC])).toBe(RULES_KEY);
    expect(documentKeyFor(action.documents[1], [WAIVER_DOC])).toBe("EVENT_RULES");
    expect(await loadEditionDocumentKeys("demo-gratis", fakeApi({ context: failure(401, "AUTH_REQUIRED"), texts: {} }).fetcher)).toEqual([]);
    expect(await loadEditionDocumentKeys("demo-gratis", fakeApi({ context: ok({}), texts: {} }).fetcher)).toEqual([]);
  });

  test("the slug is encoded into the path", async () => {
    const api = fakeApi({ texts: {} });
    await loadEditionDocumentKeys("a b/c", api.fetcher);
    expect(api.calls[0]).toBe("/api/v1/events/a%20b%2Fc/registration-context");
  });
});
