import { otpVerifySchema } from "@/lib/server/domain/auth/contracts";
import { verifyOtp } from "@/lib/server/domain/auth/service";
import { getClientIp } from "@/lib/server/http/client-ip";
import { defineRoute } from "@/lib/server/http/handler";

// auth: "public" -- there is no session yet; verifyOtp() opens its own cookie-bound client so the
// new session is persisted as HttpOnly cookies on this response (SEC-049).
export const POST = defineRoute({ auth: "public", input: { body: otpVerifySchema } }, async ({ request, input }) => ({
  data: await verifyOtp(input.body.email, input.body.code, getClientIp(request)),
}));
