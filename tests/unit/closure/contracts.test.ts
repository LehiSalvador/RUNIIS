import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  ATTENDANCE_WORKSPACE_ROW_CAP,
  CANCEL_REASON_CATEGORIES,
  CANCEL_REASON_LABELS,
  attendanceWorkspaceRowSchema,
  cancelRegistrationBodySchema,
  changeModalityBodySchema,
  closeEditionBodySchema,
  finalizeAttendanceBodySchema,
  reopenWithReasonBodySchema,
  resolveAttendanceBodySchema,
  resolveSportingEligibilityBodySchema,
} from "@/lib/shared/closure";

const id = "7b0d7f0e-2f4a-4a5e-9d0f-0a1b2c3d4e5f";

const issuePaths = (result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
  result.error?.issues.map((issue) => issue.path.join(".")) ?? [];

describe("closure request contracts (P3-C)", () => {
  it("resolve attendance: PRESENT needs reason + evidence, EXCLUDED needs reason, NO_SHOW needs neither", () => {
    expect(resolveAttendanceBodySchema.safeParse({ status: "NO_SHOW" }).success).toBe(true);
    expect(issuePaths(resolveAttendanceBodySchema.safeParse({ status: "PRESENT" }))).toEqual(expect.arrayContaining(["reason", "evidence_metadata"]));
    expect(issuePaths(resolveAttendanceBodySchema.safeParse({ status: "PRESENT", reason: "ok", evidence_metadata: {} }))).toEqual(["evidence_metadata"]);
    expect(resolveAttendanceBodySchema.safeParse({ status: "PRESENT", reason: "ok", evidence_metadata: { method: "DESK" } }).success).toBe(true);
    expect(issuePaths(resolveAttendanceBodySchema.safeParse({ status: "EXCLUDED" }))).toEqual(["reason"]);
    expect(resolveAttendanceBodySchema.safeParse({ status: "PENDING" }).success).toBe(false);
    expect(resolveAttendanceBodySchema.safeParse({ status: "NO_SHOW", extra: 1 }).success).toBe(false);
    expect(issuePaths(resolveAttendanceBodySchema.safeParse({ status: "PRESENT", reason: "ok", evidence_metadata: { blob: "x".repeat(5000) } }))).toEqual(["evidence_metadata"]);
    expect(resolveAttendanceBodySchema.safeParse({ status: "NO_SHOW", reason: "x".repeat(501) }).success).toBe(false);
    expect(resolveAttendanceBodySchema.parse({ status: "NO_SHOW", reason: "  trim  " }).reason).toBe("trim");
  });

  it("resolve eligibility: PENDING_REVIEW only with disposition PENDING, DISQUALIFIED/EXCLUDED need a reason", () => {
    expect(issuePaths(resolveSportingEligibilityBodySchema.safeParse({ status: "PENDING_REVIEW", distance_credit_disposition: "ALLOW" }))).toEqual(["distance_credit_disposition"]);
    expect(resolveSportingEligibilityBodySchema.safeParse({ status: "PENDING_REVIEW", distance_credit_disposition: "PENDING" }).success).toBe(true);
    expect(issuePaths(resolveSportingEligibilityBodySchema.safeParse({ status: "DISQUALIFIED", distance_credit_disposition: "DENY" }))).toEqual(["reason"]);
    expect(resolveSportingEligibilityBodySchema.safeParse({ status: "EXCLUDED", distance_credit_disposition: "DENY", reason: "x" }).success).toBe(true);
    expect(resolveSportingEligibilityBodySchema.safeParse({ status: "ELIGIBLE", distance_credit_disposition: "ALLOW" }).success).toBe(true);
    expect(resolveSportingEligibilityBodySchema.safeParse({ status: "ELIGIBLE", distance_credit_disposition: "SOMETIMES" }).success).toBe(false);
  });

  it("finalize: the bulk MarkRemainingNoShow scope confirmation needs a reason", () => {
    expect(finalizeAttendanceBodySchema.safeParse({}).success).toBe(true);
    expect(finalizeAttendanceBodySchema.safeParse({ mark_remaining_no_show: false }).success).toBe(true);
    expect(issuePaths(finalizeAttendanceBodySchema.safeParse({ mark_remaining_no_show: true }))).toEqual(["reason"]);
    expect(finalizeAttendanceBodySchema.safeParse({ mark_remaining_no_show: true, reason: "No se presentaron" }).success).toBe(true);
    expect(finalizeAttendanceBodySchema.safeParse({ mark_remaining_no_show: "yes" }).success).toBe(false);
  });

  it("reopen/close/cancel/change-modality bodies are strict", () => {
    expect(reopenWithReasonBodySchema.safeParse({}).success).toBe(false);
    expect(reopenWithReasonBodySchema.safeParse({ reason: "   " }).success).toBe(false);
    expect(reopenWithReasonBodySchema.safeParse({ reason: "Corrección" }).success).toBe(true);
    expect(closeEditionBodySchema.safeParse({}).success).toBe(true);
    expect(closeEditionBodySchema.safeParse({ force: true }).success).toBe(false);
    expect(cancelRegistrationBodySchema.safeParse({ reason: "Duplicada" }).success).toBe(true);
    expect(cancelRegistrationBodySchema.safeParse({ reason: "Duplicada", reason_category: "NOPE" }).success).toBe(false);
    expect(cancelRegistrationBodySchema.safeParse({ reason: "Duplicada", status: "CANCELED" }).success).toBe(false);
    expect(changeModalityBodySchema.safeParse({ new_modality_id: id, reason: "Cambio" }).success).toBe(true);
    expect(changeModalityBodySchema.safeParse({ new_modality_id: id, category_id: null, reason: "Cambio" }).success).toBe(true);
    expect(changeModalityBodySchema.safeParse({ new_modality_id: "x", reason: "Cambio" }).success).toBe(false);
    expect(changeModalityBodySchema.safeParse({ new_modality_id: id }).success).toBe(false);
  });
});

describe("cancellation reason labels (OWN-04)", () => {
  it("every category has a label and the email consumer (migration 714) renders the same wording", () => {
    const sql = readFileSync("supabase/migrations/20261004110000_714_registration_canceled_email.sql", "utf8");
    for (const category of CANCEL_REASON_CATEGORIES) {
      if (category === "OTHER") continue; // the `else` branch of the CASE
      expect(sql).toContain(`when '${category}' then '${CANCEL_REASON_LABELS[category]}'`);
    }
    expect(sql).toContain(`else '${CANCEL_REASON_LABELS.OTHER}'`);
  });

  it("the category set matches the closed set the SQL validates (migration 713)", () => {
    const sql = readFileSync("supabase/migrations/20261004100300_713_registration_cancel_change_modality.sql", "utf8");
    const match = /v_category not in \(([^)]+)\)/.exec(sql);
    expect(match).not.toBeNull();
    const sqlSet = [...match![1].matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
    expect([...sqlSet].sort()).toEqual([...CANCEL_REASON_CATEGORIES].sort());
  });
});

const workspaceRow = {
  edition_id: id,
  universe_count: 3,
  attendance_counts: { PENDING: 3 },
  eligibility_counts: { ELIGIBLE: 3 },
  disposition_pending_count: 0,
  current_finalization: null,
  current_closure: null,
  finalize_readiness: { ready: false, checks: [{ code: "NO_PENDING_ATTENDANCE", ok: false, detail: { pending_count: 2 } }], expected_count: 3 },
  close_readiness: { ready: false, checks: [{ code: "FINALIZATION_CURRENT", ok: false }] },
  participants: [],
};

describe("attendance workspace row contract", () => {
  it("accepts the sparse jsonb the database returns and rejects unexpected keys (fail closed)", () => {
    expect(attendanceWorkspaceRowSchema.safeParse(workspaceRow).success).toBe(true);
    expect(attendanceWorkspaceRowSchema.safeParse({ ...workspaceRow, attendance_counts: {} }).success).toBe(true);
    expect(attendanceWorkspaceRowSchema.safeParse({ ...workspaceRow, leaked: "pii" }).success).toBe(false);
    expect(attendanceWorkspaceRowSchema.safeParse({ ...workspaceRow, attendance_counts: { UNKNOWN: 1 } }).success).toBe(false);
  });
});

const rpc = vi.hoisted(() => ({ rows: null as unknown, calls: [] as string[] }));
vi.mock("@/lib/server/rpc", () => ({
  callRpc: async (_client: unknown, fn: string, _args: unknown, schema: { parse: (value: unknown) => unknown }) => {
    rpc.calls.push(fn);
    return fn === "consume_actor_rate_limit" ? { allowed: true } : schema.parse(rpc.rows);
  },
}));

describe("getAttendanceWorkspace", () => {
  it("marks the 2000-row cap as truncation when the universe is larger than the rows returned", async () => {
    const { getAttendanceWorkspace } = await import("@/lib/server/domain/closure/service");
    rpc.rows = { ...workspaceRow, universe_count: 2500 };
    const truncated = await getAttendanceWorkspace({} as never, id);
    expect(truncated).toMatchObject({ participants_truncated: true, participants_cap: ATTENDANCE_WORKSPACE_ROW_CAP });
    rpc.rows = { ...workspaceRow, universe_count: 0 };
    expect((await getAttendanceWorkspace({} as never, id)).participants_truncated).toBe(false);
    expect(rpc.calls).toContain("attendance_workspace");
  });
});
