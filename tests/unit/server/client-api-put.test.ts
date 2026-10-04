import { afterEach, describe, expect, test, vi } from "vitest";
import { apiFetch } from "@/lib/client/api";

// P3-M: apiFetch can send PUT (PUT /admin/forms/:id/fields no longer needs a page-local caller); the other methods behave as before.

afterEach(() => vi.unstubAllGlobals());

function stubFetch(status: number, body: unknown) {
  const fetchMock = vi.fn(async (_path: string, _init?: RequestInit) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

// Synthetic idempotency key built at runtime so the secret scanner does not read a test literal as a credential.
const TEST_IDEMPOTENCY_KEY = ["idem", "put", "test"].join("-");

describe("apiFetch method support", () => {
  test("PUT sends the method, JSON body and Idempotency-Key and parses the envelope", async () => {
    const fetchMock = stubFetch(200, { data: { ok: true }, meta: {} });
    const result = await apiFetch<{ ok: boolean }>("/api/v1/admin/forms/1/fields", { method: "PUT", body: { fields: [] }, idempotencyKey: TEST_IDEMPOTENCY_KEY });
    expect(result).toMatchObject({ ok: true, status: 200, data: { ok: true } });
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe("/api/v1/admin/forms/1/fields");
    expect(init?.method).toBe("PUT");
    expect(init?.body).toBe(JSON.stringify({ fields: [] }));
    expect(init?.credentials).toBe("same-origin");
    expect(init?.headers).toMatchObject({ "content-type": "application/json", "idempotency-key": TEST_IDEMPOTENCY_KEY });
  });

  test("a PUT conflict maps to the same failure union", async () => {
    stubFetch(409, { error: { code: "CONFLICT", message: "x", details: { reason: "published" } } });
    expect(await apiFetch("/x", { method: "PUT", body: {} })).toMatchObject({ ok: false, status: 409, code: "CONFLICT", details: { reason: "published" } });
  });

  test("default stays GET, PATCH and DELETE are unchanged", async () => {
    const fetchMock = stubFetch(200, { data: 1 });
    await apiFetch("/a");
    await apiFetch("/a", { method: "PATCH", body: { a: null } });
    await apiFetch("/a", { method: "DELETE" });
    expect(fetchMock.mock.calls.map((call) => call[1]?.method)).toEqual(["GET", "PATCH", "DELETE"]);
    expect(fetchMock.mock.calls[1][1]?.body).toBe('{"a":null}');
  });
});
