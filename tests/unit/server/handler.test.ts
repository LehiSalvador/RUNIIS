import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Actor } from "@/lib/server/auth/actor";

const mocks = vi.hoisted(() => ({
  resolveActor: vi.fn<() => Promise<Actor>>(),
  createSessionClient: vi.fn(async () => ({ marker: "session-client" })),
}));

vi.mock("@/lib/server/supabase/clients", () => ({ createSessionClient: mocks.createSessionClient }));
vi.mock("@/lib/server/auth/actor", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/auth/actor")>()),
  resolveActor: mocks.resolveActor,
}));

const { defineRoute } = await import("@/lib/server/http/handler");
const { AppError } = await import("@/lib/server/http/errors");
const { ANONYMOUS_ACTOR } = await import("@/lib/server/auth/actor");

const readyRunner: Actor = {
  auth_user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  runner_profile_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  profile_readiness: "READY",
  account_state: "ACTIVE",
  staff_member_id: null,
  staff_roles: [],
};

const ORIGIN = "http://localhost:3000";
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function request(path: string, init: { method?: string; body?: string; headers?: Record<string, string> } = {}) {
  return new NextRequest(`${ORIGIN}${path}`, {
    method: init.method ?? "GET",
    body: init.body,
    headers: init.headers,
  });
}

const jsonPost = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  request(path, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json", origin: ORIGIN, ...headers },
  });

const noParams = { params: Promise.resolve({}) };

beforeEach(() => {
  mocks.resolveActor.mockResolvedValue(readyRunner);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  mocks.resolveActor.mockReset();
});

describe("defineRoute envelope and headers", () => {
  it("wraps public data, echoes a server-generated request id and skips session work", async () => {
    const route = defineRoute({ auth: "public" }, async ({ actor }) => ({ data: { actor } }));
    const response = await route(request("/api/v1/events", { headers: { "x-request-id": "client-supplied" } }), noParams);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { actor: null }, meta: {} });
    expect(response.headers.get("x-request-id")).toMatch(UUID_REGEX);
    expect(response.headers.get("cache-control")).toBeNull();
    expect(mocks.createSessionClient).not.toHaveBeenCalled();
  });

  it("marks authenticated responses private, no-store and exposes actor + session client", async () => {
    const route = defineRoute({ auth: "authenticated" }, async ({ actor, supabase }) => ({
      data: { user: actor.auth_user_id, client: (supabase as unknown as { marker: string }).marker },
      meta: { source: "test" },
      status: 201,
    }));
    const response = await route(request("/api/v1/me"), noParams);

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ data: { user: readyRunner.auth_user_id, client: "session-client" }, meta: { source: "test" } });
  });

  it("passes raw Responses through with request id and private caching", async () => {
    const route = defineRoute({ auth: "ready" }, async () => new Response("<svg/>", { headers: { "content-type": "image/svg+xml" } }));
    const response = await route(request("/api/v1/me/passes/p/render-qr"), noParams);
    expect(await response.text()).toBe("<svg/>");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-request-id")).toMatch(UUID_REGEX);
  });
});

describe("defineRoute auth", () => {
  it("returns 401 AUTH_REQUIRED for anonymous callers before validating input", async () => {
    mocks.resolveActor.mockResolvedValue(ANONYMOUS_ACTOR);
    const handler = vi.fn();
    const route = defineRoute({ auth: "authenticated", input: { body: z.strictObject({ name: z.string() }) } }, handler);
    const response = await route(jsonPost("/api/v1/me/profile", "{broken"), noParams);

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("AUTH_REQUIRED");
    expect(body.error.request_id).toBe(response.headers.get("x-request-id"));
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns PROFILE_INCOMPLETE for ready routes", async () => {
    mocks.resolveActor.mockResolvedValue({ ...readyRunner, profile_readiness: "PROFILE_INCOMPLETE" });
    const route = defineRoute({ auth: "ready" }, async () => ({ data: null }));
    const response = await route(request("/api/v1/registration-requests"), noParams);
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("PROFILE_INCOMPLETE");
  });

  it("scopes staff routes with the edition route param", async () => {
    mocks.resolveActor.mockResolvedValue({
      ...readyRunner,
      staff_member_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      staff_roles: [{ role: "OPERATOR", scope_type: "EDITION", edition_id: "11111111-1111-4111-8111-111111111111" }],
    });
    const route = defineRoute({ auth: { staff: ["OPERATOR"], editionParam: "editionId" } }, async () => ({ data: "ok" }));

    const allowed = await route(request("/x"), { params: Promise.resolve({ editionId: "11111111-1111-4111-8111-111111111111" }) });
    const denied = await route(request("/x"), { params: Promise.resolve({ editionId: "22222222-2222-4222-8222-222222222222" }) });
    expect(allowed.status).toBe(200);
    expect(denied.status).toBe(403);
    expect((await denied.json()).error.code).toBe("FORBIDDEN");
  });
});

describe("defineRoute input validation", () => {
  const route = defineRoute(
    {
      auth: "public",
      input: {
        params: z.object({ id: z.uuid() }),
        query: z.object({ limit: z.coerce.number().int().max(10).optional(), tag: z.array(z.string()).optional() }),
        body: z.strictObject({ name: z.string().min(1).max(20), count: z.number().int().min(0) }),
      },
    },
    async ({ input }) => ({ data: input }),
  );
  const params = { params: Promise.resolve({ id: "0b8f7c5e-1d2a-4f3b-9c8d-7e6f5a4b3c2d" }) };

  it("passes parsed params, query and body to the handler", async () => {
    const response = await route(jsonPost("/api/v1/things/x?limit=5&tag=a&tag=b", { name: "Ana", count: 2 }), params);
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({
      params: { id: "0b8f7c5e-1d2a-4f3b-9c8d-7e6f5a4b3c2d" },
      query: { limit: 5, tag: ["a", "b"] },
      body: { name: "Ana", count: 2 },
    });
  });

  it.each([
    ["unknown field", { name: "Ana", count: 1, is_admin: true }],
    ["missing field", { name: "Ana" }],
    ["wrong type", { name: "Ana", count: "1" }],
    ["out of range", { name: "Ana", count: -1 }],
    ["too long", { name: "x".repeat(21), count: 1 }],
  ])("rejects %s with 400 VALIDATION_ERROR", async (_label, body) => {
    const response = await route(jsonPost("/api/v1/things/x", body), params);
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error.code).toBe("VALIDATION_ERROR");
    expect(json.error.details.issues[0].location).toBe("body");
  });

  it("reports params and query issues with their location", async () => {
    const response = await route(jsonPost("/api/v1/things/x?limit=99", { name: "Ana", count: 1 }), { params: Promise.resolve({ id: "nope" }) });
    const locations = (await response.json()).error.details.issues.map((issue: { location: string }) => issue.location);
    expect(locations).toEqual(["params", "query"]);
  });

  it.each([
    ["malformed JSON", jsonPost("/api/v1/things/x", "{not json"), "invalid_json"],
    ["wrong content type", request("/api/v1/things/x", { method: "POST", body: "a=b", headers: { "content-type": "application/x-www-form-urlencoded", origin: ORIGIN } }), "unsupported_content_type"],
    ["oversized body", jsonPost("/api/v1/things/x", { name: "x".repeat(70 * 1024), count: 1 }), "body_too_large"],
  ])("rejects %s without a 500", async (_label, req, reason) => {
    const response = await route(req, params);
    expect(response.status).toBe(400);
    expect((await response.json()).error.details.reason).toBe(reason);
  });

  it("enforces the body cap even without Content-Length (chunked)", async () => {
    const small = defineRoute({ auth: "public", maxBodyBytes: 16, input: { body: z.unknown() } }, async () => ({ data: null }));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"a":"0123456789'));
        controller.enqueue(new TextEncoder().encode('0123456789"}'));
        controller.close();
      },
    });
    const init = { method: "POST", body: stream, headers: { "content-type": "application/json", origin: ORIGIN }, duplex: "half" };
    const req = new NextRequest(new Request(`${ORIGIN}/x`, init as RequestInit));
    const response = await small(req, noParams);
    expect((await response.json()).error.details.reason).toBe("body_too_large");
  });
});

describe("defineRoute idempotency", () => {
  const route = defineRoute(
    { auth: "ready", idempotency: "required", input: { body: z.strictObject({ a: z.number(), b: z.number() }) } },
    async ({ idempotency }) => ({ data: idempotency }),
  );

  it("requires the header and hashes the canonical body", async () => {
    const missing = await route(jsonPost("/x", { a: 1, b: 2 }), noParams);
    expect(missing.status).toBe(400);
    expect((await missing.json()).error.details.header).toBe("Idempotency-Key");

    const key = "idem-000000000001";
    const first = await (await route(jsonPost("/x", '{"a":1,"b":2}', { "idempotency-key": key }), noParams)).json();
    const reordered = await (await route(jsonPost("/x", '{ "b": 2, "a": 1 }', { "idempotency-key": key }), noParams)).json();
    expect(first.data.key).toBe(key);
    expect(first.data.requestHash).toMatch(/^[0-9a-f]{64}$/);
    expect(reordered.data.requestHash).toBe(first.data.requestHash);
  });
});

describe("defineRoute failures", () => {
  it("renders AppErrors thrown by the handler (e.g. mapped RPC failures)", async () => {
    const route = defineRoute({ auth: "public" }, async () => {
      throw new AppError("DEPENDENCY_UNAVAILABLE");
    });
    const response = await route(request("/x"), noParams);
    expect(response.status).toBe(503);
  });

  it("hides unexpected errors as INTERNAL_ERROR without internals", async () => {
    const route = defineRoute({ auth: "public" }, async () => {
      throw new Error('syntax error at or near "FROM app.secret"');
    });
    const response = await route(request("/x"), noParams);
    const text = await response.text();
    expect(response.status).toBe(500);
    expect(JSON.parse(text).error.code).toBe("INTERNAL_ERROR");
    expect(text).not.toContain("secret");
    expect(text).not.toContain("FROM");
  });

  it("maps actor resolution outages to 503", async () => {
    mocks.resolveActor.mockRejectedValue(new AppError("DEPENDENCY_UNAVAILABLE"));
    const route = defineRoute({ auth: "authenticated" }, async () => ({ data: null }));
    expect((await route(request("/x"), noParams)).status).toBe(503);
  });
});

describe("defineRoute cross-site protection", () => {
  const handler = vi.fn(async () => ({ data: "done" }));
  const route = defineRoute({ auth: "authenticated" }, handler);

  it.each([
    ["cross-site Sec-Fetch-Site", { "sec-fetch-site": "cross-site", origin: "https://evil.example" }],
    ["same-site sibling", { "sec-fetch-site": "same-site", origin: "https://other.localhost:3000" }],
    ["foreign Origin without fetch metadata", { origin: "https://evil.example" }],
    ["opaque null Origin", { origin: "null" }],
  ])("rejects a %s mutation with 403 before any auth work", async (_label, headers) => {
    const response = await route(request("/api/v1/me/profile", { method: "POST", headers }), noParams);
    expect(response.status).toBe(403);
    expect((await response.json()).error.details.reason).toBe("cross_site_request");
    expect(mocks.resolveActor).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it.each([
    ["same-origin fetch", { "sec-fetch-site": "same-origin", origin: ORIGIN }],
    ["same Origin header", { origin: ORIGIN }],
    ["non-browser client", {}],
  ])("allows a %s mutation", async (_label, headers) => {
    const response = await route(request("/api/v1/me/profile", { method: "DELETE", headers }), noParams);
    expect(response.status).toBe(200);
  });

  it("never blocks safe methods", async () => {
    const response = await route(request("/api/v1/me", { headers: { "sec-fetch-site": "cross-site" } }), noParams);
    expect(response.status).toBe(200);
  });
});
