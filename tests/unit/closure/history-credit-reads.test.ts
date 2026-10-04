import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { closureHistoryQuerySchema, creditLedgerQuerySchema } from "@/lib/server/domain/closure/contracts";
import {
  attendanceWorkspaceRowSchema,
  closureHistoryPageSchema,
  creditLedgerPageSchema,
  creditedDistanceSummarySchema,
  finalizationHistoryPageSchema,
} from "@/lib/shared/closure";

// P3-T: contracts and cursor handling of the closure history / credit ledger reads. The database behaviour is proved by pgTAP 800 and the
// route-level integration test; this file pins the strict output shapes (SEC-120), the query bounds and the cursor round trip.

const id = "7b0d7f0e-2f4a-4a5e-9d0f-0a1b2c3d4e5f";
const id2 = "8c1e8f1f-3a5b-4b6f-8e1a-1b2c3d4e5f60";
const ts = "2026-10-12T10:00:00.123456+00:00";

const finalization = {
  attendance_finalization_id: id,
  edition_id: id2,
  revision: 2,
  status: "FINALIZED",
  is_current: true,
  expected_count: 3,
  present_count: 2,
  no_show_count: 1,
  excluded_count: 0,
  finalized_by_staff_id: id,
  finalized_by_staff_label: "Ana L.",
  finalized_at: ts,
  reopened_at: null,
  reopened_by_staff_id: null,
  reopened_by_staff_label: null,
  reopen_reason: null,
  superseded_at: null,
};

const closure = {
  administrative_closure_id: id,
  edition_id: id2,
  revision: 1,
  status: "SUPERSEDED",
  is_current: false,
  attendance_finalization_id: id2,
  attendance_finalization_revision: 1,
  closed_by_staff_id: id,
  closed_by_staff_label: "Staff #200000",
  closed_at: ts,
  reopened_at: ts,
  reopened_by_staff_id: id,
  reopened_by_staff_label: "Ana L.",
  reopen_reason: "Error en la lista",
  superseded_at: ts,
  credit_count: 2,
  active_credit_count: 0,
  reversed_credit_count: 2,
  active_credited_distance_m: 0,
};

const summary = {
  total_m: 10000,
  active_credit_count: 1,
  reversed_credit_count: 2,
  by_modality: [
    {
      modality_id: id,
      name: "10K",
      official_distance_m: 10000,
      generates_distance_credit: true,
      active_credit_count: 1,
      reversed_credit_count: 2,
      credited_distance_m: 10000,
    },
  ],
};

const credit = {
  distance_credit_id: id,
  edition_id: id2,
  registration_id: id2,
  registration_number: "I-8002-AAAA",
  participant_kind: "PROFILE",
  participant_label: "Runner 800-2",
  modality: { modality_id: id, name: "10K" },
  official_distance_snapshot_m: 10000,
  credited_distance_m: 10000,
  sport_date: "2026-09-20",
  sport_timezone: "America/Monterrey",
  status: "ACTIVE",
  source: "EVENT_ATTENDANCE",
  created_at: ts,
  administrative_closure_id: id,
  closure_revision: 2,
  reversed_at: null,
  reversed_by_staff_id: null,
  reversed_by_staff_label: null,
  reversal_reason: null,
  supersedes_distance_credit_id: id2,
  superseded_by_distance_credit_id: null,
};

describe("closure history and credit ledger output contracts (P3-T)", () => {
  it("accepts the pages the database returns", () => {
    expect(finalizationHistoryPageSchema.safeParse({ items: [finalization], total: 1, next_cursor: null }).success).toBe(true);
    expect(closureHistoryPageSchema.safeParse({ items: [closure], total: 2, next_cursor: { revision: 1 } }).success).toBe(true);
    expect(
      creditLedgerPageSchema.safeParse({ items: [credit], total: 3, summary, next_cursor: { revision: 2, registration_number: "I-8002-AAAA", id } }).success,
    ).toBe(true);
    expect(creditLedgerPageSchema.safeParse({ items: [], total: 0, summary: { ...summary, by_modality: [] }, next_cursor: null }).success).toBe(true);
  });

  it("fails closed on an unexpected key (a contact or PII column must never reach the client) and on a Guest credit", () => {
    expect(finalizationHistoryPageSchema.safeParse({ items: [{ ...finalization, email: "x@example.test" }], total: 1, next_cursor: null }).success).toBe(false);
    expect(closureHistoryPageSchema.safeParse({ items: [{ ...closure, status: "OPEN" }], total: 1, next_cursor: null }).success).toBe(false);
    expect(creditLedgerPageSchema.safeParse({ items: [{ ...credit, phone: "+52" }], total: 1, summary, next_cursor: null }).success).toBe(false);
    expect(creditLedgerPageSchema.safeParse({ items: [{ ...credit, participant_kind: "GUEST" }], total: 1, summary, next_cursor: null }).success).toBe(false);
    expect(creditLedgerPageSchema.safeParse({ items: [{ ...credit, status: "PENDING" }], total: 1, summary, next_cursor: null }).success).toBe(false);
  });

  it("the workspace credited_distance is additive: rows without it still parse, with it they are validated strictly", () => {
    const row = {
      edition_id: id,
      universe_count: 0,
      attendance_counts: {},
      eligibility_counts: {},
      disposition_pending_count: 0,
      current_finalization: null,
      current_closure: null,
      finalize_readiness: { ready: false, checks: [], expected_count: 0 },
      close_readiness: { ready: false, checks: [] },
      participants: [],
    };
    expect(attendanceWorkspaceRowSchema.safeParse(row).success).toBe(true);
    expect(attendanceWorkspaceRowSchema.safeParse({ ...row, credited_distance: summary }).success).toBe(true);
    expect(attendanceWorkspaceRowSchema.safeParse({ ...row, credited_distance: { ...summary, extra: 1 } }).success).toBe(false);
    expect(creditedDistanceSummarySchema.safeParse({ ...summary, total_m: "10000" }).success).toBe(false);
  });
});

describe("closure history and credit ledger query contracts (P3-T)", () => {
  it("closure-history needs an explicit kind and bounds the page", () => {
    expect(closureHistoryQuerySchema.safeParse({}).success).toBe(false);
    expect(closureHistoryQuerySchema.safeParse({ kind: "OTHER" }).success).toBe(false);
    expect(closureHistoryQuerySchema.parse({ kind: "CLOSURE", limit: "5" })).toEqual({ kind: "CLOSURE", limit: 5 });
    expect(closureHistoryQuerySchema.safeParse({ kind: "FINALIZATION", limit: "101" }).success).toBe(false);
    expect(closureHistoryQuerySchema.safeParse({ kind: "FINALIZATION", limit: "0" }).success).toBe(false);
    expect(closureHistoryQuerySchema.safeParse({ kind: "FINALIZATION", unknown: "1" }).success).toBe(false);
  });

  it("credits filters are closed sets and ids", () => {
    expect(creditLedgerQuerySchema.safeParse({}).success).toBe(true);
    expect(creditLedgerQuerySchema.safeParse({ status: "REVERSED", modality_id: id, registration_id: id2, limit: "100" }).success).toBe(true);
    expect(creditLedgerQuerySchema.safeParse({ status: "PENDING" }).success).toBe(false);
    expect(creditLedgerQuerySchema.safeParse({ modality_id: "nope" }).success).toBe(false);
    expect(creditLedgerQuerySchema.safeParse({ cursor: "x".repeat(513) }).success).toBe(false);
    expect(creditLedgerQuerySchema.safeParse({ search: "ana" }).success).toBe(false);
  });
});

const rpc = vi.hoisted(() => ({ rows: null as unknown, calls: [] as { fn: string; args: Record<string, unknown> }[] }));
vi.mock("@/lib/server/rpc", () => ({
  callRpc: async (_client: unknown, fn: string, args: Record<string, unknown>, schema: { parse: (value: unknown) => unknown }) => {
    rpc.calls.push({ fn, args });
    return schema.parse(rpc.rows);
  },
}));

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value), "utf8").toString("base64url");

describe("closure history and ledger service cursors (P3-T)", () => {
  it("encodes the next cursor and sends a decoded cursor to the right RPC with the default page sizes", async () => {
    const { listClosureHistory, listFinalizationHistory, listDistanceCredits } = await import("@/lib/server/domain/closure/service");
    rpc.calls.length = 0;

    rpc.rows = { items: [closure], total: 2, next_cursor: { revision: 1 } };
    const closures = await listClosureHistory({} as never, id2, {});
    expect(closures.nextCursor).toBe(b64({ revision: 1 }));
    expect(rpc.calls[0]).toEqual({ fn: "admin_list_administrative_closures", args: { p_edition_id: id2, p_cursor_revision: null, p_limit: 20 } });

    rpc.rows = { items: [finalization], total: 1, next_cursor: null };
    const finalizations = await listFinalizationHistory({} as never, id2, { cursor: b64({ revision: 4 }), limit: 3 });
    expect(finalizations.nextCursor).toBeNull();
    expect(rpc.calls[1]).toEqual({ fn: "admin_list_attendance_finalizations", args: { p_edition_id: id2, p_cursor_revision: 4, p_limit: 3 } });

    const next = { revision: 2, registration_number: "I-8002-AAAA", id };
    rpc.rows = { items: [credit], total: 3, summary, next_cursor: next };
    const credits = await listDistanceCredits({} as never, id2, { status: "ACTIVE", cursor: b64({ revision: 3, registration_number: "I-1", id: id2 }) });
    expect(credits.nextCursor).toBe(b64(next));
    expect(credits.summary.total_m).toBe(10000);
    expect(rpc.calls[2]).toEqual({
      fn: "admin_list_distance_credits",
      args: {
        p_edition_id: id2,
        p_status: "ACTIVE",
        p_modality_id: null,
        p_registration_id: null,
        p_cursor_revision: 3,
        p_cursor_registration_number: "I-1",
        p_cursor_id: id2,
        p_limit: 50,
      },
    });
  });

  it("an unreadable or malformed cursor falls through to the first page (never reaches SQL)", async () => {
    const { listFinalizationHistory, listDistanceCredits } = await import("@/lib/server/domain/closure/service");
    rpc.calls.length = 0;
    rpc.rows = { items: [], total: 0, next_cursor: null };
    for (const cursor of ["!!!", b64("text"), b64([1]), b64({ revision: 0 }), b64({ revision: 1.5 }), b64({ revision: "2" })]) {
      await listFinalizationHistory({} as never, id2, { cursor });
    }
    expect(rpc.calls.every((call) => call.args.p_cursor_revision === null)).toBe(true);

    rpc.calls.length = 0;
    rpc.rows = { items: [], total: 0, summary: { ...summary, by_modality: [] }, next_cursor: null };
    for (const cursor of [
      b64({ revision: 1 }),
      b64({ revision: 1, registration_number: "", id }),
      b64({ revision: 1, registration_number: "x".repeat(65), id }),
      b64({ revision: 1, registration_number: "I-1", id: "not-a-uuid" }),
      b64({ revision: 0, registration_number: "I-1", id }),
    ]) {
      await listDistanceCredits({} as never, id2, { cursor });
    }
    expect(rpc.calls).toHaveLength(5);
    expect(rpc.calls.every((call) => call.args.p_cursor_revision === null && call.args.p_cursor_id === null && call.args.p_cursor_registration_number === null)).toBe(true);
  });
});

describe("migration 800 surface", () => {
  const sql = readFileSync("supabase/migrations/20261013100000_800_p3t_closure_history_credit_reads.sql", "utf8");

  it("every granted private function has a public wrapper and the helper is never granted", () => {
    for (const name of ["admin_list_attendance_finalizations", "admin_list_administrative_closures", "admin_list_distance_credits"]) {
      expect(sql).toContain(`create function private.${name}(`);
      expect(sql).toContain(`create function public.${name}(`);
    }
    expect(sql).toMatch(/revoke all on function private\.edition_credited_distance_summary\(uuid\) from public, anon, authenticated, service_role/);
    expect(sql).not.toMatch(/grant execute on function[^;]*edition_credited_distance_summary/);
  });

  it("the reads are STABLE and never write", () => {
    const reads = sql.slice(sql.indexOf("create function private.admin_list_attendance_finalizations"), sql.indexOf("-- Public wrappers and grants"));
    expect(reads.match(/\bstable\b/g)?.length).toBeGreaterThanOrEqual(3);
    expect(reads).not.toMatch(/\b(insert into|update app|delete from|perform private\.audit|enqueue_outbox)\b/i);
  });
});
