import { expect, test } from "vitest";
import { GET } from "@/app/api/health/route";

test("health endpoint returns safe staging payload", async () => {
  const response = await GET();

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    status: "ok",
    environment: "staging",
    checks: { app: "ok" },
  });
});
