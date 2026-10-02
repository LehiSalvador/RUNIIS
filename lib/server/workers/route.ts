import "server-only";
import type { NextRequest } from "next/server";
import { getServerEnv } from "../env";
import { errorResponse, successResponse } from "../http/envelope";
import { AppError, toAppError } from "../http/errors";
import { newRequestId, runWithRequestId } from "../http/request-id";
import { logEvent } from "../log";
import { isAuthorizedWorkerRequest } from "./auth";
import { findWorker, type WorkerRegistry } from "./registry";
import { beginWorkerRun, createWorkerRunRecorder, endWorkerRun, outcomeFromError, outcomeFromSummary, type WorkerRunRecorder } from "./runs";

type WorkerRouteContext = { params: Promise<{ worker: string }> };

export function createWorkerRoute(
  registry: WorkerRegistry,
  readSecret: () => string = () => getServerEnv().INTERNAL_CRON_SECRET,
  recorder: WorkerRunRecorder = createWorkerRunRecorder(),
) {
  return (request: NextRequest, context: WorkerRouteContext): Promise<Response> => {
    const requestId = newRequestId();
    return runWithRequestId(requestId, async () => {
      let key = "";
      try {
        // Authenticate before resolving the worker so the registry cannot be enumerated.
        if (!isAuthorizedWorkerRequest(request.headers, readSecret())) {
          const response = errorResponse(requestId, new AppError("AUTH_REQUIRED"));
          response.headers.set("WWW-Authenticate", "Bearer");
          return response;
        }
        key = (await context.params).worker;
        const worker = findWorker(registry, key);
        if (!worker) throw new AppError("NOT_FOUND");

        // Master §150: one infra.worker_run per authorized, known invocation. Unauthorized and unknown
        // requests returned above and record nothing; recording failures are logged, never thrown.
        const startedAt = Date.now();
        const workerRunId = await beginWorkerRun(recorder, key);
        let summary;
        try {
          summary = await worker({ requestId });
        } catch (error) {
          await endWorkerRun(recorder, key, workerRunId, outcomeFromError(error, Date.now() - startedAt));
          throw error;
        }
        const durationMs = Date.now() - startedAt;
        await endWorkerRun(recorder, key, workerRunId, outcomeFromSummary(key, summary, durationMs));
        logEvent("info", "worker_run", { worker: key, duration_ms: durationMs });
        const response = successResponse(requestId, summary, { meta: { worker: key } });
        response.headers.set("Cache-Control", "no-store");
        return response;
      } catch (error) {
        return errorResponse(requestId, toAppError(error, { route: "internal_worker", worker: key }));
      }
    });
  };
}
