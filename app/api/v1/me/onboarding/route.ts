import { onboardingSchema } from "@/lib/server/domain/auth/contracts";
import { completeOnboarding } from "@/lib/server/domain/auth/service";
import { defineRoute } from "@/lib/server/http/handler";

// "authenticated", not "ready": this command is exactly what makes a profile READY.
export const POST = defineRoute(
  { auth: "authenticated", input: { body: onboardingSchema }, idempotency: "optional" },
  async ({ supabase, input, idempotency }) => ({
    data: await completeOnboarding(supabase, input.body, idempotency?.key ?? null),
  }),
);
