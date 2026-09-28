import type { Config } from "@netlify/functions";

// Scheduled trigger only (ADR-001 decision 10): the work runs in the Next worker route. One worker
// drains both the generic outbox and the communication message queue (see workers.ts) so a single
// schedule covers Master §147-148 end to end, including P0/P1 traffic that needs low latency.
const WORKER_PATH = "/api/internal/workers/outbox-dispatch";
const TIMEOUT_MS = 25_000;

export default async function handler(): Promise<Response> {
  const baseUrl = process.env.APP_BASE_URL;
  const secret = process.env.INTERNAL_CRON_SECRET;
  if (!baseUrl || !secret) return new Response(null, { status: 500 });
  const response = await fetch(new URL(WORKER_PATH, baseUrl), {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return new Response(null, { status: response.ok ? 204 : 502 });
}

// Every minute: Netlify Scheduled Functions' minimum granularity, and well inside the free tier's
// invocation allowance (~43k/month here) — P0/P1 email (OTP-adjacent, registration confirmations)
// should not sit queued for minutes. `claim_outbox_events`/`claim_communication_messages` use
// `FOR UPDATE SKIP LOCKED` with a lease, so an overlapping run (a slow previous invocation still
// finishing) never double-processes the same row.
export const config: Config = { schedule: "* * * * *" };
