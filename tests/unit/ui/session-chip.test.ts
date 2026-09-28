import { afterEach, describe, expect, test, vi } from "vitest";
import { fetchSessionChipState, toSessionChipState } from "@/lib/client/session-chip";

describe("toSessionChipState", () => {
  test("a 200 with authenticated:true is an authenticated chip", () => {
    expect(
      toSessionChipState(200, {
        data: { authenticated: true, display_name: "Ana Torres", avatar_url: "https://res.cloudinary.com/x/a.webp" },
      }),
    ).toEqual({ status: "authenticated", displayName: "Ana Torres", avatarUrl: "https://res.cloudinary.com/x/a.webp" });
  });

  test("falls back to a generic name when display_name is absent", () => {
    expect(toSessionChipState(200, { data: { authenticated: true, display_name: null, avatar_url: null } })).toEqual({
      status: "authenticated",
      displayName: "Mi cuenta",
      avatarUrl: null,
    });
  });

  test("authenticated:false, non-200, empty data and malformed bodies are anonymous", () => {
    expect(toSessionChipState(200, { data: { authenticated: false, display_name: null, avatar_url: null } })).toEqual({
      status: "anonymous",
    });
    expect(toSessionChipState(500, { data: { authenticated: true } })).toEqual({ status: "anonymous" });
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

  test("requests /api/v1/session uncached with same-origin credentials only", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ data: { authenticated: true, display_name: "Ana", avatar_url: null } }), {
          status: 200,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchSessionChipState()).resolves.toMatchObject({ status: "authenticated", displayName: "Ana" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/session",
      expect.objectContaining({ credentials: "same-origin", cache: "no-store" }),
    );
  });
});
