import type { Config } from "@netlify/functions";

const WORKER_PATH = "/api/internal/workers/provider-usage-reconcile";
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

// Daily at 00:05 UTC, just after `comms_reserve_quota`'s UTC usage-date rollover, so it snapshots the
// prior day's final totals (and Brevo's own reported quota, when configured) before the new day starts.
export const config: Config = { schedule: "5 0 * * *" };
