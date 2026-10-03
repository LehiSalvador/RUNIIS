import { expect, test } from "../support/fixtures";
import { e2eEnv } from "../support/env";

// Google OAuth is covered as a redirect-chain assertion only (P2-AC-01.b): the consent screen itself is
// Google's and never driven. Where the provider is disabled (local Docker) the chain ends on /entrar
// with an honest message; where it is enabled (staging/production) it must be
//   app /api/v1/auth/google -> 303 -> Supabase /auth/v1/authorize?provider=google (redirect_to = our callback)
//   -> Supabase answers with a redirect to accounts.google.com (we stop there, never follow into Google).
test.describe("Google OAuth redirect chain", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-desktop", "HTTP-level check, viewport-independent");
  });

  test("start: 303 either to the honest /entrar error or to Supabase authorize with a safe callback", async ({ request, playwright }) => {
    const start = await request.get("/api/v1/auth/google?next=%2Fcuenta%2Fpases", { maxRedirects: 0 });
    expect(start.status()).toBe(303);
    expect(start.headers()["cache-control"]).toContain("no-store");
    const location = new URL(start.headers()["location"] ?? "", e2eEnv().baseURL);

    if (location.pathname === "/entrar") {
      // Provider disabled on this target (ADR-001 A8).
      expect(location.origin).toBe(new URL(e2eEnv().baseURL).origin);
      expect(location.searchParams.get("error")).toBe("google_unavailable");
      return;
    }

    // Provider enabled: hop 1 is Supabase's authorize endpoint carrying our callback.
    expect(location.pathname).toBe("/auth/v1/authorize");
    if (e2eEnv().adminOtp) expect(location.origin).toBe(new URL(e2eEnv().adminOtp!.url).origin);
    expect(location.searchParams.get("provider")).toBe("google");
    const redirectTo = new URL(location.searchParams.get("redirect_to") ?? "");
    expect(redirectTo.origin).toBe(new URL(e2eEnv().baseURL).origin);
    expect(redirectTo.pathname).toBe("/auth/callback");
    expect(redirectTo.searchParams.get("next")).toBe("/cuenta/pases");
    // PKCE: the code verifier travels as an HttpOnly cookie set on this very response.
    const cookies = start.headersArray().filter((header) => header.name.toLowerCase() === "set-cookie").map((header) => header.value);
    const verifier = cookies.find((cookie) => /code-verifier/.test(cookie));
    expect(verifier, "PKCE verifier cookie").toBeDefined();
    expect(verifier).toMatch(/HttpOnly/i);

    // Hop 2: Supabase hands the browser to Google. A bare context, so the Vercel bypass header
    // is never sent to a third party.
    const bare = await playwright.request.newContext();
    const authorize = await bare.get(location.toString(), { maxRedirects: 0 });
    expect([302, 303, 307]).toContain(authorize.status());
    expect(new URL(authorize.headers()["location"] ?? "").hostname).toBe("accounts.google.com");
    await bare.dispose();
  });

  test("start: a hostile next never reaches the callback URL", async ({ request }) => {
    const start = await request.get("/api/v1/auth/google?next=%2F%2Fevil.example%2Fx", { maxRedirects: 0 });
    expect(start.status()).toBe(303);
    const location = new URL(start.headers()["location"] ?? "", e2eEnv().baseURL);
    expect(location.toString()).not.toContain("evil.example");
    const redirectTo = location.searchParams.get("redirect_to");
    if (redirectTo) expect(new URL(redirectTo).searchParams.get("next")).toBe("/cuenta");
  });

  test("callback without a code returns to /entrar with the cancelled-access message", async ({ page, request }) => {
    const callback = await request.get("/auth/callback", { maxRedirects: 0 });
    expect(callback.status()).toBeGreaterThanOrEqual(300);
    expect(callback.status()).toBeLessThan(400);
    const location = new URL(callback.headers()["location"] ?? "", e2eEnv().baseURL);
    expect(location.pathname).toBe("/entrar");
    expect(location.searchParams.get("error")).toBe("missing_code");

    await page.goto("/auth/callback");
    await expect(page).toHaveURL(/\/entrar\?error=missing_code$/);
    await expect(page.getByText("El acceso con Google se canceló o no terminó.")).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  });

  test("callback with an invalid code fails closed to /entrar", async ({ request }) => {
    const callback = await request.get("/auth/callback?code=not-a-real-code&next=%2Fcuenta", { maxRedirects: 0 });
    const location = new URL(callback.headers()["location"] ?? "", e2eEnv().baseURL);
    expect(location.pathname).toBe("/entrar");
    expect(location.searchParams.get("error")).toBe("auth_failed");
  });
});
