import { afterEach, describe, expect, it, vi } from "vitest";
import robots from "@/app/robots";
import { isIndexableEnvironment, pageMetadata } from "@/app/(public)/_lib/seo";

// The root layout calls next/font loaders at module scope; they only exist inside the Next compiler.
vi.mock("next/font/google", () => ({
  Archivo_Narrow: () => ({ variable: "font-archivo" }),
  Inter: () => ({ variable: "font-inter" }),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

const page = { title: "Eventos", description: "d", path: "/eventos" };
const HEADER_SOURCES = ["/:path*", "/scanner/:path*"];

describe("AUD-015: only production is indexable", () => {
  it.each(["local", "staging", "", "prod"])("APP_ENV=%j is not indexable", (appEnv) => {
    vi.stubEnv("APP_ENV", appEnv);
    expect(isIndexableEnvironment()).toBe(false);
  });

  it("an unset APP_ENV fails closed", () => {
    vi.stubEnv("APP_ENV", undefined as unknown as string);
    expect(isIndexableEnvironment()).toBe(false);
  });

  it("production is indexable", () => {
    vi.stubEnv("APP_ENV", "production");
    expect(isIndexableEnvironment()).toBe(true);
  });
});

describe("robots.txt", () => {
  it.each(["local", "staging"])("APP_ENV=%s disallows everything and publishes no sitemap", (appEnv) => {
    vi.stubEnv("APP_ENV", appEnv);
    expect(robots()).toEqual({ rules: [{ userAgent: "*", disallow: "/" }] });
  });

  it("production output is unchanged", () => {
    vi.stubEnv("APP_ENV", "production");
    vi.stubEnv("APP_BASE_URL", "https://www.runiismty.com");
    expect(robots()).toEqual({
      rules: [
        {
          userAgent: "*",
          allow: "/",
          disallow: ["/admin", "/cuenta", "/scanner", "/inscripcion", "/api", "/design-system", "/onboarding", "/entrar"],
        },
      ],
      sitemap: "https://www.runiismty.com/sitemap.xml",
    });
  });
});

describe("page metadata robots", () => {
  it("non-production pages carry noindex even without an explicit noindex flag", () => {
    vi.stubEnv("APP_ENV", "staging");
    expect(pageMetadata(page).robots).toEqual({ index: false, follow: false });
  });

  it("production pages keep the existing behaviour (no robots; explicit noindex still follows)", () => {
    vi.stubEnv("APP_ENV", "production");
    expect(pageMetadata(page).robots).toBeUndefined();
    expect(pageMetadata({ ...page, noindex: true }).robots).toEqual({ index: false, follow: true });
  });
});

describe("root layout metadata and X-Robots-Tag header", () => {
  it("non-production: layout robots noindex and a blanket X-Robots-Tag header", async () => {
    vi.stubEnv("APP_ENV", "staging");
    vi.resetModules();
    const { metadata } = await import("@/app/layout");
    expect(metadata.robots).toEqual({ index: false, follow: false });

    const config = (await import("@/next.config")).default;
    const rules = (await config.headers!()).filter((rule) => HEADER_SOURCES.includes(rule.source));
    expect(rules).toHaveLength(2);
    for (const rule of rules) expect(rule.headers).toContainEqual({ key: "X-Robots-Tag", value: "noindex, nofollow" });
  });

  it("production: no layout robots and no blanket X-Robots-Tag", async () => {
    vi.stubEnv("APP_ENV", "production");
    vi.resetModules();
    const { metadata } = await import("@/app/layout");
    expect(metadata.robots).toBeUndefined();

    const config = (await import("@/next.config")).default;
    const rules = (await config.headers!()).filter((rule) => HEADER_SOURCES.includes(rule.source));
    expect(rules).toHaveLength(2);
    for (const rule of rules) expect(rule.headers.some((header) => header.key === "X-Robots-Tag")).toBe(false);
  });
});
