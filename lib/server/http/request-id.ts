import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export const REQUEST_ID_HEADER = "x-request-id";

const requestContext = new AsyncLocalStorage<{ requestId: string }>();

// Always server-generated: client-supplied ids are not trusted for log correlation.
export function newRequestId(): string {
  return randomUUID();
}

export function runWithRequestId<T>(requestId: string, fn: () => T): T {
  return requestContext.run({ requestId }, fn);
}

export function currentRequestId(): string | null {
  return requestContext.getStore()?.requestId ?? null;
}
