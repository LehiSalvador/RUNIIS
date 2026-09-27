import { AuthApiError, AuthRetryableFetchError, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { ANONYMOUS_ACTOR, resolveActor } from "@/lib/server/auth/actor";
import { AppError } from "@/lib/server/http/errors";

const actorRow = {
  auth_user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  runner_profile_id: null,
  profile_readiness: null,
  account_state: null,
  staff_member_id: null,
  staff_roles: [],
};

function fakeClient(claims: { data: unknown; error: unknown }, rpcResult: unknown = { data: actorRow, error: null, status: 200 }) {
  const rpc = vi.fn(async () => rpcResult);
  const client = { auth: { getClaims: vi.fn(async () => claims) }, rpc } as unknown as SupabaseClient;
  return { client, rpc };
}

describe("resolveActor", () => {
  it("returns the anonymous actor without calling the RPC when there is no session", async () => {
    const { client, rpc } = fakeClient({ data: null, error: null });
    await expect(resolveActor(client)).resolves.toEqual(ANONYMOUS_ACTOR);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("treats an invalid JWT as anonymous", async () => {
    const { client } = fakeClient({ data: null, error: new AuthApiError("invalid JWT", 401, "bad_jwt") });
    await expect(resolveActor(client)).resolves.toEqual(ANONYMOUS_ACTOR);
  });

  it("maps an unreachable auth server to DEPENDENCY_UNAVAILABLE", async () => {
    const { client } = fakeClient({ data: null, error: new AuthRetryableFetchError("fetch failed", 0) });
    await expect(resolveActor(client)).rejects.toSatisfy((error) => error instanceof AppError && error.code === "DEPENDENCY_UNAVAILABLE");
  });

  it("loads public.current_actor() for a verified session and validates its contract", async () => {
    const { client, rpc } = fakeClient({ data: { claims: { sub: actorRow.auth_user_id } }, error: null });
    await expect(resolveActor(client)).resolves.toEqual(actorRow);
    expect(rpc).toHaveBeenCalledWith("current_actor", {});
  });

  it("fails closed when current_actor returns an unexpected shape", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = fakeClient(
      { data: { claims: { sub: actorRow.auth_user_id } }, error: null },
      { data: { ...actorRow, staff_roles: [{ role: "SUPERUSER", scope_type: "GLOBAL", edition_id: null }] }, error: null, status: 200 },
    );
    await expect(resolveActor(client)).rejects.toSatisfy((error) => error instanceof AppError && error.code === "INTERNAL_ERROR");
  });
});
