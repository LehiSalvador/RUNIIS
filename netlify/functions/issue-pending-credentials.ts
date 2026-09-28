import type { Config } from "@netlify/functions";

// Scheduled trigger only (ADR-001 decision 10): the work runs in the Next worker route. The target URL is
// built from APP_BASE_URL alone (SEC-070) and the secret travels only in the Authorization header.
const WORKER_PATH = "/api/internal/workers/issue-pending-credentials";
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

export const config: Config = { schedule: "*/5 * * * *" };
