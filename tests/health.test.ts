import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "../app/api/health/route";

test("health endpoint returns safe staging payload", async () => {
  const response = await GET();

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: "ok",
    environment: "staging",
    checks: { app: "ok" },
  });
});
