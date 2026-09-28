import { afterEach, describe, expect, test, vi } from "vitest";
import DesignSystemPage from "@/app/design-system/page";
import ShellPreviewPage from "@/app/design-system/shells/[shell]/page";

describe("/design-system production gate", () => {
  afterEach(() => vi.unstubAllEnvs());

  test("404s when APP_ENV is production", async () => {
    vi.stubEnv("APP_ENV", "production");
    await expect(DesignSystemPage()).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404/);
    await expect(ShellPreviewPage({ params: Promise.resolve({ shell: "admin" }) })).rejects.toThrow(
      /NEXT_HTTP_ERROR_FALLBACK;404/,
    );
  });

  test("renders outside production", async () => {
    vi.stubEnv("APP_ENV", "local");
    await expect(DesignSystemPage()).resolves.toBeTruthy();
  });
});
