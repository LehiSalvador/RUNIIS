import { createReadyUser } from "../support/account";
import { expect, test } from "../support/fixtures";
import { e2eEnv } from "../support/env";

// AUD-033: an anonymous request to /cuenta/* used to stream a 200 under loading.tsx and redirect with
// a meta refresh. It must be a real HTTP redirect to /entrar (return-to = the requested page).
const ACCOUNT_PATHS = [
  "/cuenta",
  "/cuenta/perfil",
  "/cuenta/amigos",
  "/cuenta/invitados",
  "/cuenta/menores",
  "/cuenta/solicitudes",
  "/cuenta/solicitudes/00000000-0000-4000-8000-000000000000",
  "/cuenta/pases",
  "/cuenta/pases/00000000-0000-4000-8000-000000000000",
  "/cuenta/favoritos",
  "/cuenta/comunicaciones",
];

test.describe("AUD-033: anonymous /cuenta is a real redirect", () => {
  for (const path of ACCOUNT_PATHS) {
    test(`${path} answers 3xx to /entrar with the return path, no body to stream`, async ({ playwright }, testInfo) => {
      test.skip(testInfo.project.name !== "chromium-desktop", "HTTP-level check, viewport-independent");
      // A fresh context: no cookies, and the same extra headers (bypass) the config applies.
      const request = await playwright.request.newContext({ baseURL: e2eEnv().baseURL, extraHTTPHeaders: e2eEnv().bypassHeaders });
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status(), `${path} must not stream a 200`).toBeGreaterThanOrEqual(300);
      expect(response.status()).toBeLessThan(400);
      const location = new URL(response.headers()["location"] ?? "", e2eEnv().baseURL);
      expect(location.pathname).toBe("/entrar");
      expect(location.searchParams.get("next")).toBe(path);
      expect(location.origin).toBe(new URL(e2eEnv().baseURL).origin);
      expect(response.headers()["cache-control"]).toContain("no-store");
      expect(response.headers()["content-security-policy"]).toContain("nonce-");
      expect(await response.text()).not.toContain('http-equiv="refresh"');
      await request.dispose();
    });
  }

  test("browser: anonymous /cuenta/pases lands on /entrar with the safe return path (one hop)", async ({ page }) => {
    const hops: number[] = [];
    page.on("response", (response) => {
      if (new URL(response.url()).pathname === "/cuenta/pases") hops.push(response.status());
    });
    await page.goto("/cuenta/pases");
    await expect(page).toHaveURL(/\/entrar\?next=%2Fcuenta%2Fpases$/);
    expect(hops.length).toBeGreaterThan(0);
    expect(hops.every((status) => status >= 300 && status < 400)).toBe(true);
  });

  test("signed-in behaviour is unchanged: the page renders (200) and /entrar bounces back to the return path", async ({ page }) => {
    test.skip(!e2eEnv().localDb && !e2eEnv().adminOtp, "needs local Mailpit or an admin-OTP configuration to sign in");
    await createReadyUser(page, "aud033");
    const direct = await page.request.get("/cuenta/pases", { maxRedirects: 0 });
    expect(direct.status()).toBe(200);
    const signIn = await page.request.get("/entrar?next=%2Fcuenta%2Fpases", { maxRedirects: 0 });
    expect(signIn.status()).toBeGreaterThanOrEqual(300);
    expect(signIn.status()).toBeLessThan(400);
    expect(new URL(signIn.headers()["location"] ?? "", e2eEnv().baseURL).pathname).toBe("/cuenta/pases");
    await page.goto("/cuenta/pases");
    await expect(page.getByRole("heading", { level: 1, name: "Pases" })).toBeAttached();
  });
});
