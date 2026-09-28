import type { Config } from "@netlify/functions";

const WORKER_PATH = "/api/internal/workers/communication-reconcile";
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

// Every 15 minutes (task scope): schedule triggers (T-7/T-24), campaign lifecycle sweep, birthday
// enqueue and stale-critical escalation (Master §141/§150) do not need finer granularity than this.
export const config: Config = { schedule: "*/15 * * * *" };
