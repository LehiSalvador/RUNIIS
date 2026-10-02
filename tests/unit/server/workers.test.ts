import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as productionRoute } from "@/app/api/internal/workers/[worker]/route";
import { isAuthorizedWorkerRequest } from "@/lib/server/workers/auth";
import { findWorker, workerRegistry, type WorkerRegistry } from "@/lib/server/workers/registry";
import { createWorkerRoute } from "@/lib/server/workers/route";
import type { WorkerRunRecorder } from "@/lib/server/workers/runs";

const SECRET = "worker-secret-for-unit-tests-0000000000";
const ENV_SECRET = process.env.INTERNAL_CRON_SECRET!;

const call = (headers: Record<string, string> = {}) =>
  new NextRequest("http://localhost:3000/api/internal/workers/x", { method: "POST", headers });
const params = (worker: string) => ({ params: Promise.resolve({ worker }) });

afterEach(() => vi.restoreAllMocks());

describe("isAuthorizedWorkerRequest", () => {
  it.each([
    ["exact bearer secret", `Bearer ${SECRET}`, true],
    ["missing header", undefined, false],
    ["wrong secret", "Bearer not-the-secret", false],
    ["secret prefix", `Bearer ${SECRET.slice(0, -1)}`, false],
    ["secret with suffix", `Bearer ${SECRET}x`, false],
    ["wrong scheme", `Basic ${SECRET}`, false],
    ["lowercase scheme", `bearer ${SECRET}`, false],
    ["empty token", "Bearer ", false],
  ])("%s", (_label, authorization, expected) => {
    const headers = new Headers(authorization === undefined ? {} : { authorization });
    expect(isAuthorizedWorkerRequest(headers, SECRET)).toBe(expected);
  });

  it("never authorises when the configured secret is empty", () => {
    expect(isAuthorizedWorkerRequest(new Headers({ authorization: "Bearer " }), "")).toBe(false);
  });
});

describe("worker registry", () => {
  it("holds only registered workers and ignores prototype keys", () => {
    expect(Object.keys(workerRegistry)).toContain("issue-pending-credentials");
    expect(findWorker(workerRegistry, "constructor")).toBeUndefined();
    expect(findWorker(workerRegistry, "__proto__")).toBeUndefined();
  });
});

/** Recorder double: these tests cover routing; recording has its own file (worker-runs.test.ts). */
const noRecorder: WorkerRunRecorder = { start: async () => "00000000-0000-4000-8000-000000000001", finish: async () => {} };

describe("worker route", () => {
  const run = vi.fn(async () => ({ processed: 3 }));
  const registry: WorkerRegistry = { "outbox-dispatch": run };
  const route = createWorkerRoute(registry, () => SECRET, noRecorder);

  it("returns 401 without the secret, even for unknown workers, and does not run anything", async () => {
    for (const worker of ["outbox-dispatch", "does-not-exist"]) {
      const response = await route(call(), params(worker));
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toBe("Bearer");
      expect((await response.json()).error.code).toBe("AUTH_REQUIRED");
    }
    expect(run).not.toHaveBeenCalled();
  });

  it("returns 404 for unknown or prototype worker keys", async () => {
    for (const worker of ["does-not-exist", "constructor", "toString"]) {
      const response = await route(call({ authorization: `Bearer ${SECRET}` }), params(worker));
      expect(response.status).toBe(404);
    }
  });

  it("runs a registered worker and returns its summary", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const response = await route(call({ authorization: `Bearer ${SECRET}` }), params("outbox-dispatch"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ data: { processed: 3 }, meta: { worker: "outbox-dispatch" } });
    expect(run).toHaveBeenCalledWith({ requestId: response.headers.get("x-request-id") });
  });

  it("hides worker failures behind INTERNAL_ERROR", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "error").mockImplementation((line: unknown) => void logs.push(String(line)));
    const failing = createWorkerRoute({ broken: async () => { throw new Error("smtp password=hunter2"); } }, () => SECRET, noRecorder);
    const response = await failing(call({ authorization: `Bearer ${SECRET}` }), params("broken"));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("hunter2");
    expect(logs.join("\n")).not.toContain("hunter2");
    expect(logs.join("\n")).toContain('"worker":"broken"');
  });

  it("production route reads INTERNAL_CRON_SECRET from env and has no workers yet", async () => {
    expect((await productionRoute(call(), params("anything"))).status).toBe(401);
    expect((await productionRoute(call({ authorization: `Bearer ${ENV_SECRET}` }), params("anything"))).status).toBe(404);
  });
});
