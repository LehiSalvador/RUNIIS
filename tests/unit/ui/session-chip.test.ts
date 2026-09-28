import { afterEach, describe, expect, test, vi } from "vitest";
import { fetchSessionChipState, toSessionChipState } from "@/lib/client/session-chip";

describe("toSessionChipState", () => {
  test("a 200 with data is an authenticated chip", () => {
    expect(
      toSessionChipState(200, { data: { display_name: "Ana Torres", avatar_url: "https://res.cloudinary.com/x/a.webp" } }),
    ).toEqual({ status: "authenticated", displayName: "Ana Torres", avatarUrl: "https://res.cloudinary.com/x/a.webp" });
  });

  test("reads a nested profile shape and falls back to a generic name", () => {
    expect(toSessionChipState(200, { data: { profile: { display_name: "Luis" } } })).toMatchObject({
      displayName: "Luis",
      avatarUrl: null,
    });
    expect(toSessionChipState(200, { data: {} })).toMatchObject({ status: "authenticated", displayName: "Mi cuenta" });
  });

  test("401, 404, empty data and malformed bodies are anonymous", () => {
    expect(toSessionChipState(401, { error: { code: "AUTH_REQUIRED" } })).toEqual({ status: "anonymous" });
    expect(toSessionChipState(404, null)).toEqual({ status: "anonymous" });
    expect(toSessionChipState(200, { data: null })).toEqual({ status: "anonymous" });
    expect(toSessionChipState(200, "nope")).toEqual({ status: "anonymous" });
  });
});

describe("fetchSessionChipState", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("network failures degrade to anonymous", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    await expect(fetchSessionChipState()).resolves.toEqual({ status: "anonymous" });
  });

  test("requests /api/v1/me uncached with same-origin credentials only", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ data: { display_name: "Ana" } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchSessionChipState()).resolves.toMatchObject({ status: "authenticated", displayName: "Ana" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/me",
      expect.objectContaining({ credentials: "same-origin", cache: "no-store" }),
    );
  });
});
