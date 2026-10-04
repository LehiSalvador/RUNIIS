import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Actor } from "@/lib/server/auth/actor";

// P3SECA-03 (SEC-141): defineRoute runs the shared `admin.mutation` actor pre-check for every staff mutation, after the auth guard and
// before input validation, so failed attempts count. Reads, public/participant routes and routes that opt out do not run it.

const mocks = vi.hoisted(() => ({
  resolveActor: vi.fn<() => Promise<Actor>>(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/server/supabase/clients", () => ({ createSessionClient: vi.fn(async () => ({ rpc: mocks.rpc })) }));
vi.mock("@/lib/server/auth/actor", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/auth/actor")>()),
  resolveActor: mocks.resolveActor,
}));

const { defineRoute } = await import("@/lib/server/http/handler");

const staff: Actor = {
  auth_user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  runner_profile_id: null,
  profile_readiness: null,
  account_state: null,
  staff_member_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
  staff_roles: [{ role: "OPERATOR", scope_type: "GLOBAL", edition_id: null }],
};
const ORIGIN = "http://localhost:3000";
const noParams = { params: Promise.resolve({}) };
const call = (method: string, body?: unknown) =>
  new NextRequest(`${ORIGIN}/api/v1/admin/x`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { origin: ORIGIN, ...(body === undefined ? {} : { "content-type": "application/json" }) },
  });
const bodySchema = z.strictObject({ name: z.string() });

beforeEach(() => {
  mocks.resolveActor.mockResolvedValue(staff);
  mocks.rpc.mockResolvedValue({ data: { allowed: true }, error: null, status: 200 });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  mocks.resolveActor.mockReset();
  mocks.rpc.mockReset();
});

describe("staff mutation actor pre-check", () => {
  it("runs consume_actor_rate_limit(admin.mutation) once for a staff POST, PATCH and DELETE", async () => {
    const route = defineRoute({ auth: { staff: ["OPERATOR"] } }, async () => ({ data: "ok" }));
    for (const method of ["POST", "PATCH", "DELETE"]) {
      mocks.rpc.mockClear();
      expect((await route(call(method), noParams)).status).toBe(200);
      expect(mocks.rpc).toHaveBeenCalledTimes(1);
      expect(mocks.rpc).toHaveBeenCalledWith("consume_actor_rate_limit", { p_scope: "admin.mutation" });
    }
  });

  it("does not run for reads, participant routes or public routes", async () => {
    const staffRoute = defineRoute({ auth: { staff: ["OPERATOR"] } }, async () => ({ data: "ok" }));
    expect((await staffRoute(call("GET"), noParams)).status).toBe(200);
    mocks.resolveActor.mockResolvedValue({
      ...staff,
      staff_member_id: null,
      staff_roles: [],
      runner_profile_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      profile_readiness: "READY",
      account_state: "ACTIVE",
    });
    const readyRoute = defineRoute({ auth: "ready" }, async () => ({ data: "ok" }));
    expect((await readyRoute(call("POST"), noParams)).status).toBe(200);
    const publicRoute = defineRoute({ auth: "public" }, async () => ({ data: "ok" }));
    expect((await publicRoute(call("POST"), noParams)).status).toBe(200);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("race-day routes opt out with actorRateLimit: false (they keep their own raceday.* limits)", async () => {
    const scan = defineRoute({ auth: { staff: ["OPERATOR"] }, actorRateLimit: false }, async () => ({ data: "ok" }));
    expect((await scan(call("POST"), noParams)).status).toBe(200);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("does not run for a caller the auth guard already refused (no counter for strangers)", async () => {
    mocks.resolveActor.mockResolvedValue({ ...staff, staff_member_id: null, staff_roles: [] });
    const route = defineRoute({ auth: { staff: ["OPERATOR"] } }, async () => ({ data: "ok" }));
    expect((await route(call("POST"), noParams)).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("counts attempts that fail input validation (pre-check runs before the body is parsed) and stops an exhausted actor with 429 before the handler", async () => {
    const handler = vi.fn(async () => ({ data: "ok" }));
    const route = defineRoute({ auth: { staff: ["OPERATOR"] }, input: { body: bodySchema } }, handler);
    const invalid = await route(call("POST", { nope: 1 }), noParams);
    expect(invalid.status).toBe(400);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);

    mocks.rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "RATE_LIMITED", details: "{}" }, status: 400 });
    const limited = await route(call("POST", { name: "x" }), noParams);
    expect(limited.status).toBe(429);
    expect((await limited.json()).error.code).toBe("RATE_LIMITED");
    expect(handler).not.toHaveBeenCalled();
  });
});
