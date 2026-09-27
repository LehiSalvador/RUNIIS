import { describe, expect, it } from "vitest";
import { ANONYMOUS_ACTOR, type Actor } from "@/lib/server/auth/actor";
import { assertAuthLevel, type AuthLevel } from "@/lib/server/auth/guards";
import { AppError } from "@/lib/server/http/errors";

const EDITION_A = "11111111-1111-4111-8111-111111111111";
const EDITION_B = "22222222-2222-4222-8222-222222222222";

const runner: Actor = {
  auth_user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  runner_profile_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  profile_readiness: "READY",
  account_state: "ACTIVE",
  staff_member_id: null,
  staff_roles: [],
};

const checkinForA: Actor = {
  ...runner,
  staff_member_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  staff_roles: [{ role: "CHECKIN", scope_type: "EDITION", edition_id: EDITION_A }],
};

const globalAdmin: Actor = {
  ...runner,
  staff_member_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  staff_roles: [{ role: "ADMIN", scope_type: "GLOBAL", edition_id: null }],
};

function outcome(actor: Actor, level: AuthLevel, params: Record<string, string> = {}): string {
  try {
    assertAuthLevel(actor, level, params);
    return "ALLOWED";
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return (error as AppError).code;
  }
}

describe("assertAuthLevel", () => {
  it("lets anyone through public routes", () => {
    expect(outcome(ANONYMOUS_ACTOR, "public")).toBe("ALLOWED");
  });

  it("requires a signed-in user for authenticated routes", () => {
    expect(outcome(ANONYMOUS_ACTOR, "authenticated")).toBe("AUTH_REQUIRED");
    expect(outcome({ ...runner, profile_readiness: "PROFILE_INCOMPLETE" }, "authenticated")).toBe("ALLOWED");
  });

  it.each<[string, Partial<Actor>, string]>([
    ["ready and active", {}, "ALLOWED"],
    ["incomplete profile", { profile_readiness: "PROFILE_INCOMPLETE" }, "PROFILE_INCOMPLETE"],
    ["no runner profile yet", { runner_profile_id: null, profile_readiness: null, account_state: "ACTIVE" }, "PROFILE_INCOMPLETE"],
    ["banned", { account_state: "BANNED" }, "ACCOUNT_BANNED"],
    ["identity locked", { account_state: "IDENTITY_LOCKED" }, "IDENTITY_LOCKED"],
    ["deactivated", { account_state: "DEACTIVATED" }, "FORBIDDEN"],
    ["banned beats incomplete", { account_state: "BANNED", profile_readiness: "PROFILE_INCOMPLETE" }, "ACCOUNT_BANNED"],
  ])("ready level: %s", (_label, patch, expected) => {
    expect(outcome({ ...runner, ...patch }, "ready")).toBe(expected);
  });

  it("denies anonymous and non-staff callers on staff routes", () => {
    expect(outcome(ANONYMOUS_ACTOR, { staff: ["ADMIN"] })).toBe("AUTH_REQUIRED");
    expect(outcome(runner, { staff: ["ADMIN"] })).toBe("FORBIDDEN");
  });

  it("requires one of the listed roles", () => {
    expect(outcome(checkinForA, { staff: ["ADMIN", "OPERATOR"] })).toBe("FORBIDDEN");
    expect(outcome(checkinForA, { staff: ["CHECKIN"] })).toBe("ALLOWED");
  });

  it("scopes EDITION roles to the Edition in the route param", () => {
    const level: AuthLevel = { staff: ["CHECKIN", "ADMIN"], editionParam: "editionId" };
    expect(outcome(checkinForA, level, { editionId: EDITION_A })).toBe("ALLOWED");
    expect(outcome(checkinForA, level, { editionId: EDITION_A.toUpperCase() })).toBe("ALLOWED");
    expect(outcome(checkinForA, level, { editionId: EDITION_B })).toBe("FORBIDDEN");
    expect(outcome(checkinForA, level, {})).toBe("FORBIDDEN");
    expect(outcome(globalAdmin, level, { editionId: EDITION_B })).toBe("ALLOWED");
  });
});
