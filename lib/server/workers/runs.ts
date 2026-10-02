import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { AppError } from "../http/errors";
import { logEvent } from "../log";
import { callRpc } from "../rpc";
import { createSystemClient } from "../supabase/clients";
import type { WorkerSummary } from "./registry";

// Master §150: every authorized, known worker invocation leaves one infra.worker_run row
// (RUNNING -> SUCCEEDED | PARTIAL | FAILED) written through public.start_worker_run /
// public.finish_worker_run (service_role only). Recording is observability, never control flow:
// the route guards every call here so a recording failure cannot change the worker's outcome.

export type WorkerRunStatus = "SUCCEEDED" | "PARTIAL" | "FAILED";

export type WorkerRunOutcome = {
  status: WorkerRunStatus;
  processedCount: number;
  errorCount: number;
  metadata: Record<string, string | number | boolean | null>;
};

export type WorkerRunRecorder = {
  /** Opens a RUNNING row and returns its id. */
  start(workerKey: string): Promise<string>;
  /** Closes the row; a no-op in SQL when the row is no longer RUNNING. */
  finish(workerRunId: string, outcome: WorkerRunOutcome): Promise<void>;
};

// finish_worker_run rejects metadata above 4096 characters of JSON text.
const MAX_METADATA_CHARS = 4096;

type CountRule = { processed: readonly string[]; errors: readonly string[] };

// Which summary fields count as work done vs. work that failed, per worker. A key outside this
// table (or a field a worker does not report) simply counts as zero; `retried` is a normal
// transient state and is not an error. Unknown workers fall back to `processed` / `errors`.
const COUNT_RULES: Readonly<Record<string, CountRule>> = {
  "issue-pending-credentials": { processed: ["issued"], errors: ["failed"] },
  "outbox-dispatch": {
    processed: ["outbox_processed", "messages_accepted"],
    errors: ["outbox_escalated", "messages_failed", "messages_blocked"],
  },
  "communication-reconcile": {
    processed: ["campaigns_started", "campaigns_closed", "schedule_messages", "birthday_messages", "escalated", "expired_pending_reminders"],
    errors: [],
  },
  "provider-usage-reconcile": { processed: ["brevo_sent_total", "capture_sent_total"], errors: [] },
};
const FALLBACK_RULE: CountRule = { processed: ["processed"], errors: ["errors", "failed"] };

function sum(summary: WorkerSummary, keys: readonly string[]): number {
  let total = 0;
  for (const key of keys) {
    const value = summary[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) total += Math.trunc(value);
  }
  return total;
}

function boundedMetadata(metadata: WorkerRunOutcome["metadata"]): WorkerRunOutcome["metadata"] {
  return JSON.stringify(metadata).length <= MAX_METADATA_CHARS ? metadata : { truncated: true };
}

/** Maps a worker's returned summary to the run row: FAILED when nothing succeeded, PARTIAL when some did. */
export function outcomeFromSummary(workerKey: string, summary: WorkerSummary, durationMs: number): WorkerRunOutcome {
  const rule = Object.hasOwn(COUNT_RULES, workerKey) ? COUNT_RULES[workerKey]! : FALLBACK_RULE;
  const processedCount = sum(summary, rule.processed);
  const errorCount = sum(summary, rule.errors);
  const status: WorkerRunStatus = errorCount === 0 ? "SUCCEEDED" : processedCount === 0 ? "FAILED" : "PARTIAL";
  const scalars = Object.fromEntries(Object.entries(summary).filter(([, v]) => v === null || ["string", "number", "boolean"].includes(typeof v)));
  return { status, processedCount, errorCount, metadata: boundedMetadata({ ...scalars, duration_ms: durationMs }) };
}

/** A worker that threw: FAILED with the stable error code only (never the message, which may carry data). */
export function outcomeFromError(error: unknown, durationMs: number): WorkerRunOutcome {
  const errorCode = error instanceof AppError ? error.code : "INTERNAL_ERROR";
  return { status: "FAILED", processedCount: 0, errorCount: 1, metadata: { error_code: errorCode, duration_ms: durationMs } };
}

export function createWorkerRunRecorder(getClient: () => SupabaseClient = createSystemClient): WorkerRunRecorder {
  return {
    start: (workerKey) => callRpc(getClient(), "start_worker_run", { p_worker_key: workerKey }, z.uuid()),
    async finish(workerRunId, outcome) {
      await callRpc(
        getClient(),
        "finish_worker_run",
        {
          p_worker_run_id: workerRunId,
          p_status: outcome.status,
          p_processed_count: outcome.processedCount,
          p_error_count: outcome.errorCount,
          p_metadata: outcome.metadata,
        },
        z.unknown(),
      );
    },
  };
}

/** Opens a run; returns null (and logs) when recording is unavailable so the worker still runs. */
export async function beginWorkerRun(recorder: WorkerRunRecorder, workerKey: string): Promise<string | null> {
  try {
    return await recorder.start(workerKey);
  } catch (error) {
    logEvent("error", "worker_run_record_failed", { worker: workerKey, phase: "start", error_code: error instanceof AppError ? error.code : "INTERNAL_ERROR" });
    return null;
  }
}

/** Closes a run; never throws. */
export async function endWorkerRun(recorder: WorkerRunRecorder, workerKey: string, workerRunId: string | null, outcome: WorkerRunOutcome): Promise<void> {
  if (workerRunId === null) return;
  try {
    await recorder.finish(workerRunId, outcome);
  } catch (error) {
    logEvent("error", "worker_run_record_failed", { worker: workerKey, phase: "finish", error_code: error instanceof AppError ? error.code : "INTERNAL_ERROR" });
  }
}
