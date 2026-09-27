import "server-only";

export type WorkerContext = { requestId: string };
/** Small scalar summary returned to the scheduler and logged; never rows or personal data. */
export type WorkerSummary = Record<string, string | number | boolean | null>;
export type WorkerHandler = (context: WorkerContext) => Promise<WorkerSummary>;
export type WorkerRegistry = Readonly<Record<string, WorkerHandler>>;

/** Provider-dependent workers served at /api/internal/workers/<key> (ADR-001 decision 10). */
export const workerRegistry: WorkerRegistry = {};

export function findWorker(registry: WorkerRegistry, key: string): WorkerHandler | undefined {
  // Own keys only: "constructor" or "__proto__" must not resolve to Object.prototype members.
  return Object.hasOwn(registry, key) ? registry[key] : undefined;
}
