import { signOut } from "@/lib/server/domain/auth/service";
import { defineRoute } from "@/lib/server/http/handler";

// Server-side revocation (ADR-001 A8): signOut() calls supabase.auth.signOut() on the cookie-bound
// client, which revokes the refresh token at GoTrue, then clears the session cookies on this response.
export const POST = defineRoute({ auth: "authenticated" }, async () => {
  await signOut();
  return { data: { status: "signed_out" } };
});
