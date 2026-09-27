import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AppError } from "@/lib/server/http/errors";
import { callRpc } from "@/lib/server/rpc";

type RpcResult = { data: unknown; error: { code: string; message: string; details: string | null; hint?: string } | null; status: number };

function fakeClient(result: RpcResult) {
  const rpc = vi.fn(async () => result);
  return { client: { rpc } as unknown as SupabaseClient, rpc };
}

async function rejection(promise: Promise<unknown>): Promise<AppError> {
  const error = await promise.then(
    () => {
      throw new Error("expected rejection");
    },
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(AppError);
  return error as AppError;
}

const resultSchema = z.object({ id: z.string() });
const logs: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  logs.length = 0;
});

function captureLogs() {
  for (const method of ["error", "warn", "info"] as const) {
    vi.spyOn(console, method).mockImplementation((line: unknown) => void logs.push(String(line)));
  }
}

describe("callRpc", () => {
  it("returns validated data and passes args through", async () => {
    const { client, rpc } = fakeClient({ data: { id: "abc" }, error: null, status: 200 });
    await expect(callRpc(client, "create_thing", { name: "x" }, resultSchema)).resolves.toEqual({ id: "abc" });
    expect(rpc).toHaveBeenCalledWith("create_thing", { name: "x" });
  });

  it("maps P0001 with a catalogued code and JSON detail to that AppError", async () => {
    const { client } = fakeClient({
      data: null,
      error: { code: "P0001", message: "CAPACITY_UNAVAILABLE", details: '{"modality_id":"m-1"}' },
      status: 400,
    });
    const error = await rejection(callRpc(client, "create_registration_request", {}, resultSchema));
    expect(error.code).toBe("CAPACITY_UNAVAILABLE");
    expect(error.status).toBe(409);
    expect(error.details).toEqual({ modality_id: "m-1" });
  });

  it("ignores non-object or malformed detail", async () => {
    for (const details of ["not json", "[1,2]", null]) {
      const { client } = fakeClient({ data: null, error: { code: "P0001", message: "REGISTRATION_CLOSED", details }, status: 400 });
      expect((await rejection(callRpc(client, "fn", {}, resultSchema))).details).toEqual({});
    }
  });

  it("turns an uncatalogued P0001 message into INTERNAL_ERROR without logging its text", async () => {
    captureLogs();
    const { client } = fakeClient({
      data: null,
      error: { code: "P0001", message: "runner jane@example.test not allowed", details: null },
      status: 400,
    });
    const error = await rejection(callRpc(client, "fn", {}, resultSchema));
    expect(error.code).toBe("INTERNAL_ERROR");
    expect(logs.join("\n")).not.toContain("jane@example.test");
    expect(logs.join("\n")).toContain("<non-code>");
  });

  it("maps unknown SQL errors to INTERNAL_ERROR and never leaks SQL text", async () => {
    captureLogs();
    const sqlText = 'relation "app.secret_table" does not exist';
    const { client } = fakeClient({ data: null, error: { code: "42P01", message: sqlText, details: null }, status: 404 });
    const error = await rejection(callRpc(client, "fn", {}, resultSchema));
    expect(error.code).toBe("INTERNAL_ERROR");
    expect(error.publicMessage).not.toContain("secret_table");
    expect(logs.join("\n")).not.toContain("secret_table");
    expect(logs.join("\n")).toContain("42P01");
  });

  it.each([
    ["42501", 403, "FORBIDDEN"],
    ["23505", 409, "CONFLICT"],
    ["40001", 409, "CONFLICT"],
    ["57014", 500, "DEPENDENCY_UNAVAILABLE"],
    ["PGRST301", 401, "AUTH_REQUIRED"],
    ["", 0, "DEPENDENCY_UNAVAILABLE"],
    ["", 503, "DEPENDENCY_UNAVAILABLE"],
  ])("maps infrastructure code %s (HTTP %i) to %s", async (code, status, expected) => {
    captureLogs();
    const { client } = fakeClient({ data: null, error: { code, message: "TypeError: fetch failed", details: "stack…" }, status });
    expect((await rejection(callRpc(client, "fn", {}, resultSchema))).code).toBe(expected);
  });

  it("marks only serialization and deadlock conflicts as retryable", async () => {
    captureLogs();
    const retryable = fakeClient({ data: null, error: { code: "40P01", message: "deadlock", details: null }, status: 500 });
    expect((await rejection(callRpc(retryable.client, "fn", {}, resultSchema))).details).toEqual({ retryable: true });
    const duplicate = fakeClient({ data: null, error: { code: "23505", message: "dup", details: null }, status: 409 });
    expect((await rejection(callRpc(duplicate.client, "fn", {}, resultSchema))).details).toEqual({});
  });

  it("rejects results that do not match the declared schema", async () => {
    captureLogs();
    const { client } = fakeClient({ data: { unexpected: true }, error: null, status: 200 });
    expect((await rejection(callRpc(client, "fn", {}, resultSchema))).code).toBe("INTERNAL_ERROR");
  });
});
