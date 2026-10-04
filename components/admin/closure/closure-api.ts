"use client";

import React from "react";
import type { z } from "zod";
import { apiFetch, newIdempotencyKey, type ApiFailure, type ApiResult } from "@/lib/client/api";
import { attendanceWorkspaceSchema, type AttendanceWorkspace } from "@/lib/shared/closure";
import { endsIntent } from "@/components/admin/closure/closure-logic";

/**
 * Browser side of the closure APIs (P3-C contract). Two rules from the contract shape this file:
 * - The attendance workspace WRITES (it reconciles the universe under an Edition lock), so it is never prefetched or revalidated in the
 *   background: it is read explicitly when the desk opens, after every successful command and on a manual refresh. No polling.
 * - Every command carries ONE Idempotency-Key per user intent. The key is reused for the retry of a lost connection / rate limit / lock
 *   conflict (same body), and renewed after any definitive refusal or when the operator changed what is sent.
 * Nothing is reported as done before the server answered and its answer parsed against the shared schema.
 */

export const adminBase = (editionId: string) => `/api/v1/admin/editions/${editionId}`;
export const workspacePath = (editionId: string) => `${adminBase(editionId)}/attendance`;

function unexpected(status: number): ApiFailure {
  return { ok: false, status, code: "INTERNAL_ERROR", message: "", requestId: null, details: {} };
}

export async function fetchWorkspace(editionId: string, signal?: AbortSignal): Promise<ApiResult<AttendanceWorkspace>> {
  const result = await apiFetch<unknown>(workspacePath(editionId), { signal });
  if (!result.ok) return result;
  const parsed = attendanceWorkspaceSchema.safeParse(result.data);
  if (!parsed.success) return unexpected(result.status);
  return { ...result, data: parsed.data };
}

export type WorkspaceState =
  | { status: "loading" }
  | { status: "error"; failure: ApiFailure }
  | { status: "ready"; data: AttendanceWorkspace; loadedAt: string; refreshing: boolean; refreshFailure: ApiFailure | null };

/**
 * Loads the workspace once on mount and again only when `refresh()` is called. The latest request wins: a slower answer to an older request
 * never replaces a newer one, and a request still in flight is aborted by the next one.
 */
export function useWorkspace(editionId: string): { state: WorkspaceState; refresh: () => Promise<boolean> } {
  const [state, setState] = React.useState<WorkspaceState>({ status: "loading" });
  const sequence = React.useRef(0);
  const controller = React.useRef<AbortController | null>(null);

  const apply = React.useCallback((result: ApiResult<AttendanceWorkspace>): boolean => {
    if (result.ok) {
      setState({ status: "ready", data: result.data, loadedAt: new Date().toISOString(), refreshing: false, refreshFailure: null });
      return true;
    }
    setState((current) => (current.status === "ready" ? { ...current, refreshing: false, refreshFailure: result } : { status: "error", failure: result }));
    return false;
  }, []);

  /** Manual or after-command read: keeps the last data on screen (marked as refreshing) until the answer arrives. */
  const refresh = React.useCallback(async (): Promise<boolean> => {
    const mine = ++sequence.current;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setState((current) => (current.status === "ready" ? { ...current, refreshing: true } : current));
    let result: ApiResult<AttendanceWorkspace>;
    try {
      result = await fetchWorkspace(editionId, abort.signal);
    } catch {
      return false; // aborted by a newer request or by leaving the page
    }
    if (mine !== sequence.current) return false;
    return apply(result);
  }, [editionId, apply]);

  // The opening read: explicit, once per Edition (no polling, no background revalidation).
  React.useEffect(() => {
    const mine = ++sequence.current;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    void fetchWorkspace(editionId, abort.signal).then(
      (result) => {
        if (mine === sequence.current) apply(result);
      },
      () => undefined, // aborted
    );
    return () => {
      sequence.current += 1;
      abort.abort();
    };
  }, [editionId, apply]);

  return { state, refresh };
}

/**
 * Runs one command at a time. `run` resolves to the parsed server answer, or null after a failure (then `failure` holds it). A second press while
 * one is in flight is ignored. `onRefusal` lets the screen re-read the workspace when the refusal means the data changed under the operator.
 */
export function useCommand(onRefusal?: (failure: ApiFailure) => void) {
  const [pending, setPending] = React.useState(false);
  const [failure, setFailure] = React.useState<ApiFailure | null>(null);
  const busy = React.useRef(false);
  const last = React.useRef<{ body: string; key: string } | null>(null);
  const refusal = React.useRef(onRefusal);
  React.useEffect(() => {
    refusal.current = onRefusal;
  });

  const run = React.useCallback(async <S extends z.ZodType>(path: string, body: unknown, schema: S): Promise<z.output<S> | null> => {
    if (busy.current) return null;
    busy.current = true;
    setPending(true);
    setFailure(null);
    try {
      const serialized = JSON.stringify(body);
      if (!last.current || last.current.body !== serialized) last.current = { body: serialized, key: newIdempotencyKey() };
      const result = await apiFetch<unknown>(path, { method: "POST", body, idempotencyKey: last.current.key });
      if (!result.ok) {
        if (endsIntent(result)) last.current = null;
        setFailure(result);
        refusal.current?.(result);
        return null;
      }
      const parsed = schema.safeParse(result.data);
      if (!parsed.success) {
        // The command may have applied: never show success, and never replay under a new key blindly. The screen re-reads the truth.
        last.current = null;
        const bad = unexpected(result.status);
        setFailure(bad);
        refusal.current?.(bad);
        return null;
      }
      last.current = null;
      return parsed.data;
    } finally {
      busy.current = false;
      setPending(false);
    }
  }, []);

  return { run, pending, failure, clearFailure: React.useCallback(() => setFailure(null), []) };
}
