import "server-only";
import { getServerEnv } from "@/lib/server/env";

/**
 * Whether GoTrue has the Google provider enabled (it is disabled in local Docker, ADR-001 A8). Read
 * from the public /auth/v1/settings document; if it cannot be read, report "enabled" and let the
 * OAuth start/callback surface a real failure rather than hiding a working provider.
 */
export async function isGoogleSignInEnabled(): Promise<boolean> {
  const env = getServerEnv();
  try {
    const response = await fetch(new URL("/auth/v1/settings", env.NEXT_PUBLIC_SUPABASE_URL), {
      headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY },
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return true;
    const settings = (await response.json()) as { external?: { google?: unknown } };
    return settings.external?.google !== false;
  } catch {
    return true;
  }
}
