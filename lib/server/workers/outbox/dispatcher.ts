import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { callRpc } from "../../rpc";
import { toAppError } from "../../http/errors";
import { logEvent } from "../../log";
import { backoffRetryAt } from "./backoff";
import { outboxConsumerRegistry } from "./consumers";

export const OUTBOX_WORKER_ID = "outbox-dispatch";
const DEFAULT_LIMIT = 50;
const LEASE_SECONDS = 120;
const RETRY_BASE_MS = 10_000;
const RETRY_MAX_MS = 30 * 60_000;

const claimedEventSchema = z.object({
  outbox_event_id: z.uuid(),
  event_type: z.string(),
  aggregate_type: z.string(),
  aggregate_id: z.uuid(),
  effect_key: z.string(),
  payload: z.unknown(),
  attempt_count: z.number().int(),
});
const claimedEventsSchema = z.array(claimedEventSchema);
const completeResultSchema = z.object({ applied: z.boolean() });

export type OutboxDispatchSummary = { claimed: number; processed: number; retried: number; escalated: number };

/**
 * Drains the outbox for every event type with a registered consumer (Master §147-148): claim with a
 * lease (`FOR UPDATE SKIP LOCKED`, expired PROCESSING rows reclaimed by the SQL side), run the
 * consumer, complete. A consumer failure retries with backoff+jitter up to its `maxAttempts`, then
 * ESCALATES (AdminTask, `communication-critical-failure:{message}` semantics live in the SQL side).
 */
export async function runOutboxDispatch(system: SupabaseClient, options: { limit?: number } = {}): Promise<OutboxDispatchSummary> {
  const eventTypes = Object.keys(outboxConsumerRegistry);
  const summary: OutboxDispatchSummary = { claimed: 0, processed: 0, retried: 0, escalated: 0 };
  if (eventTypes.length === 0) return summary;

  const claimed = await callRpc(
    system,
    "claim_outbox_events",
    { p_worker: OUTBOX_WORKER_ID, p_event_types: eventTypes, p_limit: options.limit ?? DEFAULT_LIMIT, p_lease_seconds: LEASE_SECONDS },
    claimedEventsSchema,
  );
  summary.claimed = claimed.length;

  for (const event of claimed) {
    const consumer = outboxConsumerRegistry[event.event_type];
    if (!consumer) {
      // Claimed by type but unregistered at runtime cannot happen (claim only requests known types);
      // guard anyway so a future bug fails loud instead of looping forever on this event.
      await completeOutboxEvent(system, event.outbox_event_id, "ESCALATE", "UNKNOWN_EVENT_TYPE", null);
      summary.escalated += 1;
      continue;
    }
    try {
      await callRpc(system, consumer.rpc, { p_outbox_event_id: event.outbox_event_id }, z.unknown());
      await completeOutboxEvent(system, event.outbox_event_id, "PROCESSED", null, null);
      summary.processed += 1;
    } catch (error) {
      const appError = toAppError(error, { worker: OUTBOX_WORKER_ID, outbox_event_id: event.outbox_event_id });
      if (event.attempt_count >= consumer.maxAttempts) {
        await completeOutboxEvent(system, event.outbox_event_id, "ESCALATE", appError.code, null);
        logEvent("error", "outbox_event_escalated", { event_type: event.event_type, outbox_event_id: event.outbox_event_id, error_code: appError.code });
        summary.escalated += 1;
      } else {
        const retryAt = backoffRetryAt(event.attempt_count, { baseMs: RETRY_BASE_MS, maxMs: RETRY_MAX_MS });
        await completeOutboxEvent(system, event.outbox_event_id, "RETRY", appError.code, retryAt);
        summary.retried += 1;
      }
    }
  }
  return summary;
}

async function completeOutboxEvent(
  system: SupabaseClient,
  outboxEventId: string,
  outcome: "PROCESSED" | "RETRY" | "ESCALATE",
  errorCode: string | null,
  retryAt: Date | null,
): Promise<void> {
  const result = await callRpc(
    system,
    "complete_outbox_event",
    { p_outbox_event_id: outboxEventId, p_worker: OUTBOX_WORKER_ID, p_outcome: outcome, p_error_code: errorCode, p_retry_at: retryAt?.toISOString() ?? null },
    completeResultSchema,
  );
  if (!result.applied) {
    // Lease was lost to a reclaim (this worker ran past LEASE_SECONDS); not an error, just a no-op.
    logEvent("warn", "outbox_complete_not_applied", { outbox_event_id: outboxEventId, outcome });
  }
}
