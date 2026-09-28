import "server-only";
import { createSystemClient } from "../../supabase/clients";
import type { WorkerHandler } from "../../workers/registry";
import { runOutboxDispatch } from "../../workers/outbox/dispatcher";
import { runCommunicationDispatch } from "./dispatch";
import { runCommunicationReconcile, runProviderUsageReconcile } from "./reconcile";

/**
 * `outbox-dispatch` (Netlify scheduled, tightest free-tier-safe cadence): drains the generic outbox
 * (Master §147-148) and then the communication message queue in the same run — Netlify's free tier
 * caps scheduled-function invocations, so one worker does both instead of two separate schedules.
 */
export const outboxDispatchWorker: WorkerHandler = async () => {
  const system = createSystemClient();
  const outbox = await runOutboxDispatch(system);
  const dispatch = await runCommunicationDispatch(system);
  return {
    outbox_claimed: outbox.claimed,
    outbox_processed: outbox.processed,
    outbox_retried: outbox.retried,
    outbox_escalated: outbox.escalated,
    messages_claimed: dispatch.claimed,
    messages_accepted: dispatch.accepted,
    messages_retried: dispatch.retried,
    messages_failed: dispatch.failed,
    messages_blocked: dispatch.blocked,
  };
};

/** `communication-reconcile` (Netlify scheduled, 15 min): Master §141/§150 schedule + lifecycle sweep. */
export const communicationReconcileWorker: WorkerHandler = () => runCommunicationReconcile(createSystemClient());

/** `provider-usage-reconcile` (Netlify scheduled, daily): refreshes daily usage snapshots. */
export const providerUsageReconcileWorker: WorkerHandler = () => runProviderUsageReconcile(createSystemClient());
