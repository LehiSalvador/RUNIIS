import "server-only";
import { NextResponse } from "next/server";
import { resolveActor } from "@/lib/server/auth/actor";
import { getMyProfile } from "@/lib/server/domain/auth/service";
import { REQUEST_ID_HEADER, newRequestId, runWithRequestId } from "@/lib/server/http/request-id";
import { logEvent } from "@/lib/server/log";
import { createSessionClient } from "@/lib/server/supabase/clients";

/**
 * ADR-001 A9 / SEC-052: the public header session chip polls this on every page, including cached,
 * cookie-less pages, so it must be cheap, read-only and never surface as a fetch failure -- always
 * 200, whatever the auth state, so an anonymous visitor's network tab stays clean and a transient
 * dependency failure degrades to the anonymous chip instead of looking broken. Display hint only:
 * GET /api/v1/me and every real guard/DB command re-authorise independently.
 */
export async function GET() {
  const requestId = newRequestId();
  return runWithRequestId(requestId, async () => {
    const body = await probe();
    const response = NextResponse.json({ data: body, meta: {} }, { status: 200 });
    response.headers.set(REQUEST_ID_HEADER, requestId);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  });
}

type SessionProbeBody = { authenticated: boolean; display_name: string | null; avatar_url: string | null };

async function probe(): Promise<SessionProbeBody> {
  try {
    const supabase = await createSessionClient();
    const actor = await resolveActor(supabase);
    if (!actor.auth_user_id) return { authenticated: false, display_name: null, avatar_url: null };
    // Read-only (no ensure/insert here: a probe hit on every page must never write).
    const profile = await getMyProfile(supabase).catch(() => null);
    return { authenticated: true, display_name: profile?.community?.display_name ?? null, avatar_url: null };
  } catch (error) {
    // Always degrades to the anonymous body (this endpoint never fails the response), but a
    // systemic outage should still be visible in logs instead of just looking like "logged out".
    logEvent("warn", "session_probe_failed", { error_name: error instanceof Error ? error.name : typeof error });
    return { authenticated: false, display_name: null, avatar_url: null };
  }
}
