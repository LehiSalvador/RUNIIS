import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { localAnonClient } from "../supabase";

// Route-level integration harness for the staff closure/cancellation APIs (P3-C). The real route modules run
// (defineRoute: same-origin guard, auth early reject, zod input, Idempotency-Key, envelope, error mapping) against the real
// local Postgres with real signed-in staff sessions. Only the cookie-bound session client is substituted by the caller's
// session-bound client, resolved per call through AsyncLocalStorage so two requests can run concurrently as different staff.
// (A second `next dev` cannot share this checkout with the frontend's server: Next holds a per-directory dev lock.)

export const sessionStore = new AsyncLocalStorage<SupabaseClient>();

export type RouteHandler = (request: NextRequest, context: { params: Promise<Record<string, string | string[] | undefined>> }) => Promise<Response>;
export type RouteResponse = { status: number; body: any; headers: Headers };

const ORIGIN = process.env.APP_BASE_URL ?? "http://127.0.0.1:3100";

export function sessionOrAnon(client: SupabaseClient | null): SupabaseClient {
  return client ?? localAnonClient();
}

export async function callRoute(
  handler: RouteHandler,
  options: {
    method?: "GET" | "POST";
    path: string;
    params?: Record<string, string>;
    body?: unknown;
    /** Idempotency-Key; mutations default to a fresh key. Pass `null` to omit the header. */
    key?: string | null;
    as: SupabaseClient | null;
    headers?: Record<string, string>;
  },
): Promise<RouteResponse> {
  const method = options.method ?? "POST";
  const headers: Record<string, string> = { ...options.headers };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (method === "POST" && options.key !== null) headers["idempotency-key"] = options.key ?? `it-${randomUUID()}`;
  const request = new NextRequest(new URL(options.path, ORIGIN), {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const response = await sessionStore.run(sessionOrAnon(options.as), () => handler(request, { params: Promise.resolve(options.params ?? {}) }));
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, headers: response.headers };
}
