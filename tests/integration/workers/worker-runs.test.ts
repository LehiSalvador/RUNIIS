import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { APP_URL, queryValue, sql } from "../helpers";

// Master §150 / P1-AC-12.f: an authorized HTTP worker invocation leaves one infra.worker_run row with a
// final status and counts. Runs against the dev server on :3100 (same INTERNAL_CRON_SECRET as the
// server reads from .env.development.local). `provider-usage-reconcile` is used because it only
// refreshes daily usage snapshots (no outbound mail, no credential issuance).

const WORKER = "provider-usage-reconcile";
const secret = process.env.INTERNAL_CRON_SECRET;
let startedAfter = "";

const post = (worker: string, authorization?: string) =>
  fetch(new URL(`/api/internal/workers/${worker}`, APP_URL), { method: "POST", headers: authorization ? { authorization } : {} });

beforeAll(() => {
  if (!secret) throw new Error("Integration tests need INTERNAL_CRON_SECRET (.env.development.local)");
  startedAfter = queryValue("select clock_timestamp()::text") ?? "";
});

// Scheduled runs (pg_cron) of the same worker may land in the window; only rows from this test's window are removed.
afterAll(() => sql(`delete from infra.worker_run where worker_key in ('${WORKER}', 'no-such-worker') and started_at >= '${startedAfter}'`));

describe("HTTP worker route records infra.worker_run", () => {
  test("an authorized invocation closes a run with a final status, counts and duration", async () => {
    const response = await post(WORKER, `Bearer ${secret}`);
    expect(response.status).toBe(200);
    expect((await response.json()).meta.worker).toBe(WORKER);

    const row = queryValue(`select concat_ws('|', status, (completed_at is not null)::text, processed_count, error_count, (metadata ? 'duration_ms')::text)
      from infra.worker_run where worker_key = '${WORKER}' and started_at >= '${startedAfter}' order by started_at desc limit 1`);
    expect(row).not.toBeNull();
    const [status, completed, processed, errors, hasDuration] = row!.split("|");
    expect(status).toBe("SUCCEEDED");
    expect(completed).toBe("true");
    expect(Number(processed)).toBeGreaterThanOrEqual(0);
    expect(errors).toBe("0");
    expect(hasDuration).toBe("true");
    expect(queryValue(`select count(*)::text from infra.worker_run where worker_key = '${WORKER}' and started_at >= '${startedAfter}' and status = 'RUNNING'`)).toBe("0");
  });

  test("unauthorized and unknown-worker requests record nothing", async () => {
    expect((await post("no-such-worker")).status).toBe(401);
    expect((await post("no-such-worker", "Bearer wrong-secret-0000000000000000000000000")).status).toBe(401);
    expect((await post("no-such-worker", `Bearer ${secret}`)).status).toBe(404);
    expect(queryValue(`select count(*)::text from infra.worker_run where worker_key = 'no-such-worker'`)).toBe("0");
  });
});
