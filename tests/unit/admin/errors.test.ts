import { describe, expect, test } from "vitest";
import { ERROR_CATALOG } from "@/lib/shared/api-contract";
import { COVERED_CODES, REQUIRED_KINDS, describeFailure, type AdminErrorKind } from "@/components/admin/errors";
import type { ApiFailureCode } from "@/lib/client/api";

const ALL_CODES = [...Object.keys(ERROR_CATALOG), "NETWORK_ERROR"] as ApiFailureCode[];

describe("admin actionable error model (P3-AC-15)", () => {
  test("every API error code and the synthetic network code has a staff message", () => {
    expect([...COVERED_CODES].sort()).toEqual([...ALL_CODES].sort());
  });

  test("the seven kinds the acceptance names are all reachable", () => {
    const kinds = new Set(ALL_CODES.map((code) => describeFailure({ code }).kind));
    for (const kind of REQUIRED_KINDS) expect(kinds.has(kind), kind).toBe(true);
  });

  test.each<[ApiFailureCode, AdminErrorKind]>([
    ["VALIDATION_ERROR", "validation"],
    ["FORM_INVALID", "validation"],
    ["FORBIDDEN", "permission"],
    ["ACCOUNT_BANNED", "permission"],
    ["AUTH_REQUIRED", "auth"],
    ["CONFLICT", "stale"],
    ["PRICE_CHANGED", "stale"],
    ["REQUEST_EXPIRED", "stale"],
    ["DUPLICATE_REGISTRATION", "conflict"],
    ["PARTICIPANT_ALREADY_HELD", "conflict"],
    ["ALREADY_CHECKED_IN", "conflict"],
    ["CAPACITY_UNAVAILABLE", "capacity"],
    ["GLOBAL_CAPACITY_UNAVAILABLE", "capacity"],
    ["DEPENDENCY_UNAVAILABLE", "provider"],
    ["NETWORK_ERROR", "network"],
    ["CLOSURE_BLOCKED", "rule"],
    ["NOT_FOUND", "not_found"],
    ["RATE_LIMITED", "rate_limit"],
    ["INTERNAL_ERROR", "unexpected"],
  ])("%s is a %s error", (code, kind) => {
    expect(describeFailure({ code }).kind).toBe(kind);
  });

  test("every message is Spanish, actionable, and free of internals", () => {
    for (const code of ALL_CODES) {
      const view = describeFailure({ code });
      const text = `${view.title} ${view.message}`;
      expect(view.title.length, code).toBeGreaterThan(3);
      expect(view.message.length, code).toBeGreaterThan(20);
      expect(text, code).not.toMatch(/sql|select |insert |postgres|supabase|stack|exception|undefined|null|\bat \w+\.\w+/i);
      expect(text, code).not.toContain(code);
    }
  });

  test("the server message is never shown: a hostile message cannot reach the view", () => {
    const view = describeFailure({
      code: "INTERNAL_ERROR",
      // describeFailure takes no message at all; extra fields are ignored by construction
      ...({ message: 'duplicate key value violates unique constraint "registration_pkey"' } as object),
    } as never);
    expect(JSON.stringify(view)).not.toMatch(/duplicate key|violates|registration_pkey/);
  });

  test("the request id is kept for every kind, so support can correlate", () => {
    for (const code of ALL_CODES) {
      expect(describeFailure({ code, requestId: "req-123" }).requestId, code).toBe("req-123");
    }
    expect(describeFailure({ code: "NETWORK_ERROR" }).requestId).toBeNull();
  });

  test("actions match the kind: reload for stale data, retry for transient, sign in for a dead session", () => {
    expect(describeFailure({ code: "CONFLICT" }).action).toBe("reload");
    expect(describeFailure({ code: "DEPENDENCY_UNAVAILABLE" }).action).toBe("retry");
    expect(describeFailure({ code: "NETWORK_ERROR" }).action).toBe("retry");
    expect(describeFailure({ code: "AUTH_REQUIRED" }).action).toBe("signin");
    expect(describeFailure({ code: "VALIDATION_ERROR" }).action).toBe("fix");
    expect(describeFailure({ code: "INTERNAL_ERROR" }).action).toBe("support");
  });

  test("validation exposes the flagged fields from either server shape", () => {
    const zod = describeFailure({ code: "VALIDATION_ERROR", details: { issues: [{ path: "name.first" }, { path: "slug" }] } });
    expect([...zod.fields.keys()]).toEqual(["name", "slug"]);
    const db = describeFailure({ code: "VALIDATION_ERROR", details: { field: "city", reason: "required" } });
    expect(db.fields.get("city")).toBe("required");
    expect(describeFailure({ code: "CONFLICT", details: { field: "city" } }).fields.size).toBe(0);
  });

  test("rate limiting carries the wait", () => {
    expect(describeFailure({ code: "RATE_LIMITED", details: { retry_after_seconds: 7.2 } }).retryAfterSeconds).toBe(8);
    expect(describeFailure({ code: "RATE_LIMITED" }).retryAfterSeconds).toBeNull();
  });

  test("an unknown code from a newer server degrades to the generic unexpected error", () => {
    const view = describeFailure({ code: "SOMETHING_NEW" as ApiFailureCode });
    expect(view.kind).toBe("unexpected");
    expect(view.message).not.toContain("SOMETHING_NEW");
  });
});
