import { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/server/http/errors";
import { createWorkerRoute } from "@/lib/server/workers/route";
import { createWorkerRunRecorder, outcomeFromError, outcomeFromSummary, type WorkerRunOutcome, type WorkerRunRecorder } from "@/lib/server/workers/runs";

// Master §150: each authorized, known worker invocation records one infra.worker_run.

const SECRET = "worker-secret-for-unit-tests-0000000000";
const RUN_ID = "00000000-0000-4000-8000-000000000001";
const headers = { authorization: `Bearer ${SECRET}` };

const call = (requestHeaders: Record<string, string> = {}) =>
  new NextRequest("http://localhost:3000/api/internal/workers/x", { method: "POST", headers: requestHeaders });
const params = (worker: string) => ({ params: Promise.resolve({ worker }) });

/** Recorder double: never touches the database. */
function fakeRecorder() {
  const start = vi.fn(async (_workerKey: string) => RUN_ID);
  const finish = vi.fn(async (_workerRunId: string, _outcome: WorkerRunOutcome) => {});
  const recorder: WorkerRunRecorder = { start, finish };
  return { recorder, start, finish };
}

function captureLogs() {
  const lines: string[] = [];
  const sink = (line: unknown) => void lines.push(String(line));
  vi.spyOn(console, "info").mockImplementation(sink);
  vi.spyOn(console, "warn").mockImplementation(sink);
  vi.spyOn(console, "error").mockImplementation(sink);
  return lines;
}

afterEach(() => vi.restoreAllMocks());

describe("worker route records infra.worker_run", () => {
  it("opens a run before the worker and closes it SUCCEEDED with counts and the scalar summary", async () => {
    captureLogs();
    const { recorder, start, finish } = fakeRecorder();
    const order: string[] = [];
    start.mockImplementation(async () => (order.push("start"), RUN_ID));
    finish.mockImplementation(async () => void order.push("finish"));
    const route = createWorkerRoute(
      { "outbox-dispatch": async () => (order.push("worker"), { outbox_processed: 2, messages_accepted: 3, messages_retried: 4 }) },
      () => SECRET,
      recorder,
    );

    const response = await route(call(headers), params("outbox-dispatch"));

    expect(response.status).toBe(200);
    expect(order).toEqual(["start", "worker", "finish"]);
    expect(start).toHaveBeenCalledWith("outbox-dispatch");
    expect(finish).toHaveBeenCalledTimes(1);
    const [id, outcome] = finish.mock.calls[0]!;
    expect(id).toBe(RUN_ID);
    expect(outcome).toMatchObject({ status: "SUCCEEDED", processedCount: 5, errorCount: 0 });
    expect(outcome.metadata).toMatchObject({ outbox_processed: 2, messages_accepted: 3, messages_retried: 4 });
  });

  it("closes the run PARTIAL when some work succeeded and some failed", async () => {
    captureLogs();
    const { recorder, finish } = fakeRecorder();
    const route = createWorkerRoute({ "issue-pending-credentials": async () => ({ issued: 4, failed: 1, remaining: false }) }, () => SECRET, recorder);
    expect((await route(call(headers), params("issue-pending-credentials"))).status).toBe(200);
    expect(finish.mock.calls[0]![1]).toMatchObject({ status: "PARTIAL", processedCount: 4, errorCount: 1 });
  });

  it("closes the run FAILED with only the error code when the worker throws, and still returns the original error", async () => {
    captureLogs();
    const { recorder, finish } = fakeRecorder();
    const route = createWorkerRoute({ broken: async () => { throw new AppError("DEPENDENCY_UNAVAILABLE"); } }, () => SECRET, recorder);

    const response = await route(call(headers), params("broken"));

    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("DEPENDENCY_UNAVAILABLE");
    const outcome = finish.mock.calls[0]![1];
    expect(outcome).toMatchObject({ status: "FAILED", processedCount: 0, errorCount: 1 });
    expect(outcome.metadata).toMatchObject({ error_code: "DEPENDENCY_UNAVAILABLE" });
  });

  it("does not leak an untyped worker error message into the run", async () => {
    captureLogs();
    const { recorder, finish } = fakeRecorder();
    const route = createWorkerRoute({ broken: async () => { throw new Error("smtp password=hunter2"); } }, () => SECRET, recorder);
    expect((await route(call(headers), params("broken"))).status).toBe(500);
    expect(JSON.stringify(finish.mock.calls[0]![1])).not.toContain("hunter2");
    expect(finish.mock.calls[0]![1].metadata).toMatchObject({ error_code: "INTERNAL_ERROR" });
  });

  it("records nothing for unauthorized or unknown-worker requests", async () => {
    captureLogs();
    const { recorder, start, finish } = fakeRecorder();
    const route = createWorkerRoute({ "outbox-dispatch": async () => ({ processed: 1 }) }, () => SECRET, recorder);
    expect((await route(call(), params("outbox-dispatch"))).status).toBe(401);
    expect((await route(call(), params("does-not-exist"))).status).toBe(401);
    expect((await route(call(headers), params("does-not-exist"))).status).toBe(404);
    expect((await route(call(headers), params("constructor"))).status).toBe(404);
    expect(start).not.toHaveBeenCalled();
    expect(finish).not.toHaveBeenCalled();
  });

  it("a failing start does not stop the worker or fail the response, and finish is skipped", async () => {
    const logs = captureLogs();
    const { recorder, start, finish } = fakeRecorder();
    start.mockRejectedValue(new AppError("DEPENDENCY_UNAVAILABLE"));
    const worker = vi.fn(async () => ({ processed: 1 }));
    const route = createWorkerRoute({ "outbox-dispatch": worker }, () => SECRET, recorder);

    const response = await route(call(headers), params("outbox-dispatch"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { processed: 1 }, meta: { worker: "outbox-dispatch" } });
    expect(worker).toHaveBeenCalledTimes(1);
    expect(finish).not.toHaveBeenCalled();
    expect(logs.join("\n")).toContain("worker_run_record_failed");
  });

  it("a failing finish does not turn a successful worker into a failure", async () => {
    const logs = captureLogs();
    const { recorder, finish } = fakeRecorder();
    finish.mockRejectedValue(new Error("connection reset"));
    const route = createWorkerRoute({ "outbox-dispatch": async () => ({ processed: 1 }) }, () => SECRET, recorder);

    const response = await route(call(headers), params("outbox-dispatch"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { processed: 1 }, meta: { worker: "outbox-dispatch" } });
    expect(logs.join("\n")).toContain("worker_run_record_failed");
  });

  it("a failing finish does not mask the original worker error", async () => {
    const logs = captureLogs();
    const { recorder, finish } = fakeRecorder();
    finish.mockRejectedValue(new Error("connection reset"));
    const route = createWorkerRoute({ broken: async () => { throw new AppError("CONFLICT"); } }, () => SECRET, recorder);

    const response = await route(call(headers), params("broken"));

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("CONFLICT");
    expect(logs.join("\n")).toContain("worker_run_record_failed");
  });
});

describe("worker run outcome mapping", () => {
  it("counts per-worker fields and treats retried as a non-error", () => {
    const summary = { outbox_processed: 1, outbox_retried: 5, outbox_escalated: 1, messages_accepted: 2, messages_failed: 0, messages_blocked: 1 };
    expect(outcomeFromSummary("outbox-dispatch", summary, 9)).toMatchObject({ status: "PARTIAL", processedCount: 3, errorCount: 2 });
  });

  it("is FAILED when there are errors and no successful work, SUCCEEDED for an idle run", () => {
    expect(outcomeFromSummary("issue-pending-credentials", { issued: 0, failed: 2, remaining: true }, 1).status).toBe("FAILED");
    expect(outcomeFromSummary("outbox-dispatch", { outbox_processed: 0, messages_accepted: 0 }, 1)).toMatchObject({
      status: "SUCCEEDED",
      processedCount: 0,
      errorCount: 0,
    });
  });

  it("counts reconcile sweeps and provider snapshots as processed work", () => {
    const sweep = { campaigns_started: 1, campaigns_closed: 0, schedule_messages: 2, birthday_messages: 0, escalated: 0, expired_pending_reminders: 1 };
    expect(outcomeFromSummary("communication-reconcile", sweep, 1).processedCount).toBe(4);
    const usage = { brevo_sent_total: 7, brevo_auth_otp: 1, brevo_daily_limit: 300, capture_sent_total: 3 };
    expect(outcomeFromSummary("provider-usage-reconcile", usage, 1).processedCount).toBe(10);
  });

  it("falls back to processed/errors for unknown workers, ignores junk values and bounds the metadata", () => {
    expect(outcomeFromSummary("custom-worker", { processed: 3, errors: 1 }, 1)).toMatchObject({ status: "PARTIAL", processedCount: 3, errorCount: 1 });
    expect(outcomeFromSummary("constructor", { processed: -4, errors: Number.NaN }, 1)).toMatchObject({ status: "SUCCEEDED", processedCount: 0, errorCount: 0 });
    const huge = Object.fromEntries(Array.from({ length: 400 }, (_, i) => [`field_${i}`, "x".repeat(20)]));
    expect(outcomeFromSummary("custom-worker", huge, 1).metadata).toEqual({ truncated: true });
  });

  it("outcomeFromError keeps only a stable code", () => {
    expect(outcomeFromError(new AppError("NOT_FOUND"), 4)).toEqual({
      status: "FAILED",
      processedCount: 0,
      errorCount: 1,
      metadata: { error_code: "NOT_FOUND", duration_ms: 4 },
    });
    expect(outcomeFromError(new Error("secret=abc"), 4).metadata).toEqual({ error_code: "INTERNAL_ERROR", duration_ms: 4 });
  });
});

describe("createWorkerRunRecorder", () => {
  it("calls start_worker_run and finish_worker_run with the contract arguments", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: RUN_ID, error: null, status: 200 })
      .mockResolvedValueOnce({ data: null, error: null, status: 204 });
    const recorder = createWorkerRunRecorder(() => ({ rpc }) as unknown as SupabaseClient);

    expect(await recorder.start("outbox-dispatch")).toBe(RUN_ID);
    await recorder.finish(RUN_ID, { status: "PARTIAL", processedCount: 3, errorCount: 1, metadata: { duration_ms: 5 } });

    expect(rpc).toHaveBeenNthCalledWith(1, "start_worker_run", { p_worker_key: "outbox-dispatch" });
    expect(rpc).toHaveBeenNthCalledWith(2, "finish_worker_run", {
      p_worker_run_id: RUN_ID,
      p_status: "PARTIAL",
      p_processed_count: 3,
      p_error_count: 1,
      p_metadata: { duration_ms: 5 },
    });
  });

  it("rejects a start result that is not a uuid", async () => {
    captureLogs();
    const rpc = vi.fn().mockResolvedValue({ data: "not-a-uuid", error: null, status: 200 });
    await expect(createWorkerRunRecorder(() => ({ rpc }) as unknown as SupabaseClient).start("outbox-dispatch")).rejects.toBeInstanceOf(AppError);
  });
});
