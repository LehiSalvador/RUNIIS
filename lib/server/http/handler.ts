import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import type { z } from "zod";
import type { JsonObject } from "@/lib/shared/api-contract";
import { resolveActor, type Actor } from "../auth/actor";
import { assertAuthLevel, type AuthLevel } from "../auth/guards";
import { getServerEnv } from "../env";
import { createSessionClient } from "../supabase/clients";
import { errorResponse, successResponse } from "./envelope";
import { AppError, toAppError } from "./errors";
import { computeRequestHash, readIdempotencyKey, type IdempotencyInput, type IdempotencyMode } from "./idempotency";
import { newRequestId, REQUEST_ID_HEADER, runWithRequestId } from "./request-id";
import { isCrossSiteMutation } from "./same-origin";

export const DEFAULT_MAX_BODY_BYTES = 64 * 1024;
const MAX_REPORTED_ISSUES = 20;
const AUTHENTICATED_CACHE_CONTROL = "private, no-store";

type InputSchemas = { body?: z.ZodType; query?: z.ZodType; params?: z.ZodType };
type Output<S> = S extends z.ZodType ? z.output<S> : undefined;
type RouteParams = Record<string, string | string[] | undefined>;

export type RouteInput<I extends InputSchemas> = {
  body: Output<I["body"]>;
  query: Output<I["query"]>;
  params: Output<I["params"]>;
};

export type RouteContext<A extends AuthLevel, I extends InputSchemas, M extends IdempotencyMode> = {
  request: NextRequest;
  requestId: string;
  input: RouteInput<I>;
  idempotency: M extends "required" ? IdempotencyInput : IdempotencyInput | null;
} & (A extends "public" ? { actor: null } : { actor: Actor; supabase: SupabaseClient });

/** Return data for the standard envelope, or a raw Response (SVG, CSV) that still gets the standard headers. */
export type RouteResult<T> = Response | { data: T; meta?: JsonObject; status?: number; headers?: HeadersInit };

export type RouteOptions<A extends AuthLevel, I extends InputSchemas, M extends IdempotencyMode> = {
  auth: A;
  /** Use z.strictObject for bodies so unknown fields are rejected. */
  input?: I;
  idempotency?: M;
  maxBodyBytes?: number;
};

type NextRouteHandler = (request: NextRequest, context: { params: Promise<RouteParams> }) => Promise<Response>;

/**
 * Wraps an App Router handler with: request id, cross-site mutation rejection, auth early
 * rejects, zod input validation, Idempotency-Key parsing and the {data, meta}/{error} envelope.
 */
export function defineRoute<
  const A extends AuthLevel,
  I extends InputSchemas = Record<never, never>,
  M extends IdempotencyMode = "none",
  T = unknown,
>(options: RouteOptions<A, I, M>, handler: (context: RouteContext<A, I, M>) => Promise<RouteResult<T>>): NextRouteHandler {
  const isPublic = options.auth === "public";

  return (request, routeContext) => {
    const requestId = newRequestId();
    return runWithRequestId(requestId, async () => {
      try {
        if (isCrossSiteMutation(request, allowedOrigins(request))) {
          throw new AppError("FORBIDDEN", { details: { reason: "cross_site_request" } });
        }
        const rawParams = await routeContext.params;

        let auth: { actor: null } | { actor: Actor; supabase: SupabaseClient } = { actor: null };
        if (!isPublic) {
          const supabase = await createSessionClient();
          const actor = await resolveActor(supabase);
          assertAuthLevel(actor, options.auth, rawParams);
          auth = { actor, supabase };
        }

        const input = await parseInput(request, rawParams, options.input ?? {}, options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES);
        const key = readIdempotencyKey(request.headers, options.idempotency ?? "none");
        const idempotency = key === null ? null : { key, requestHash: computeRequestHash(input.body) };

        // The conditional context type cannot be narrowed from runtime checks; the shape is built to match it above.
        const context = { request, requestId, input, idempotency, ...auth } as unknown as RouteContext<A, I, M>;
        const result = await handler(context);
        return finalize(result, requestId, isPublic);
      } catch (error) {
        return errorResponse(requestId, toAppError(error, { method: request.method, route: request.nextUrl.pathname }));
      }
    });
  };
}

function allowedOrigins(request: NextRequest): string[] {
  if (request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS") return [];
  return [request.nextUrl.origin, new URL(getServerEnv().APP_BASE_URL).origin];
}

function finalize<T>(result: RouteResult<T>, requestId: string, isPublic: boolean): Response {
  const response =
    result instanceof Response
      ? result
      : successResponse(requestId, result.data, { meta: result.meta, status: result.status, headers: result.headers });
  response.headers.set(REQUEST_ID_HEADER, requestId);
  if (!isPublic) response.headers.set("Cache-Control", AUTHENTICATED_CACHE_CONTROL);
  return response;
}

async function parseInput<I extends InputSchemas>(
  request: NextRequest,
  rawParams: RouteParams,
  schemas: I,
  maxBodyBytes: number,
): Promise<RouteInput<I>> {
  const issues: JsonObject[] = [];
  const validate = (location: string, schema: z.ZodType | undefined, value: unknown) => {
    if (!schema) return undefined;
    const result = schema.safeParse(value);
    if (result.success) return result.data;
    for (const issue of result.error.issues) {
      issues.push({ location, path: issue.path.map(String).join("."), code: issue.code, message: issue.message });
    }
    return undefined;
  };

  const params = validate("params", schemas.params, rawParams);
  const query = validate("query", schemas.query, searchParamsToObject(request.nextUrl.searchParams));
  const body = schemas.body ? validate("body", schemas.body, await readJsonBody(request, maxBodyBytes)) : undefined;

  if (issues.length > 0) {
    throw new AppError("VALIDATION_ERROR", { details: { issues: issues.slice(0, MAX_REPORTED_ISSUES) } });
  }
  return { params, query, body } as RouteInput<I>;
}

function searchParamsToObject(searchParams: URLSearchParams): Record<string, string | string[]> {
  const grouped = new Map<string, string[]>();
  for (const [key, value] of searchParams) grouped.set(key, [...(grouped.get(key) ?? []), value]);
  // fromEntries defines own properties, so a "__proto__" key cannot alter the prototype.
  return Object.fromEntries([...grouped].map(([key, values]) => [key, values.length === 1 ? values[0] : values]));
}

async function readJsonBody(request: Request, maxBytes: number): Promise<unknown> {
  const invalid = (reason: string) => new AppError("VALIDATION_ERROR", { details: { location: "body", reason } });

  if (!/^application\/json\s*(;|$)/i.test(request.headers.get("content-type") ?? "")) throw invalid("unsupported_content_type");
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > maxBytes) throw invalid("body_too_large");
  if (!request.body) throw invalid("missing_body");

  // Stream with a hard cap: Content-Length can be absent (chunked) or wrong.
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw invalid("body_too_large");
    }
    chunks.push(value);
  }

  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  } catch {
    throw invalid("invalid_json");
  }
}
