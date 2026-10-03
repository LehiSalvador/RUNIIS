import type { APIRequestContext } from "@playwright/test";
import { knownSecrets, redactSecrets } from "./redact";

/**
 * Failure of an API call made by a harness helper. Playwright's own error carries a "Call log" with every request
 * header (bypass secret, cookies); this one reports the method, the path (no query) and a scrubbed reason only
 * (H2P2-04). The original error is deliberately not attached as `cause`.
 */
export class ApiCallError extends Error {
  constructor(
    readonly method: string,
    readonly path: string,
    reason: string,
  ) {
    super(`API ${method} ${path} failed: ${reason}`);
    this.name = "ApiCallError";
  }
}

const METHODS = ["get", "post", "put", "patch", "delete", "head", "fetch"] as const;

function pathOf(input: unknown): string {
  const raw = typeof input === "string" ? input : "<request>";
  try {
    return new URL(raw, "http://placeholder.invalid").pathname;
  } catch {
    return "<unparseable>";
  }
}

/** The one-line reason of a Playwright API error: "socket hang up", "Timeout 30000ms exceeded.", ... never the call log. */
export function failureReason(error: unknown, secrets: readonly string[] = knownSecrets()): string {
  const message = error instanceof Error ? error.message : String(error);
  const first = message.split("\n", 1)[0].replace(/^apiRequestContext\.[a-z]+:\s*/i, "");
    const plain = first.replace(/\u001b\[[0-9;]*m/g, "");
  return redactSecrets(plain, secrets).slice(0, 200) || "request failed";
}

/**
 * The same context with every request method failing as an `ApiCallError`. Responses are returned untouched
 * (they carry no call log; assert `response.status()`, never the toBeOK matcher, which prints headers).
 */
export function safeApi(request: APIRequestContext): APIRequestContext {
  return new Proxy(request, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property, target);
      if (typeof property === "string" && (METHODS as readonly string[]).includes(property) && typeof value === "function") {
        return async (...args: unknown[]) => {
          try {
            return await (value as (...inner: unknown[]) => Promise<unknown>).apply(target, args);
          } catch (error) {
            throw new ApiCallError(property.toUpperCase(), pathOf(args[0]), failureReason(error));
          }
        };
      }
      return typeof value === "function" ? (value as (...inner: unknown[]) => unknown).bind(target) : value;
    },
  });
}
