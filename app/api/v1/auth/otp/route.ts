import { otpRequestSchema } from "@/lib/server/domain/auth/contracts";
import { requestOtp } from "@/lib/server/domain/auth/service";
import { getClientIp } from "@/lib/server/http/client-ip";
import { defineRoute } from "@/lib/server/http/handler";

// SEC-043: the response is identical for every email state (new/existing/banned/blocked) so this
// endpoint never leaks account existence; requestOtp() itself never throws on upstream/user state.
export const POST = defineRoute({ auth: "public", input: { body: otpRequestSchema } }, async ({ request, input }) => {
  await requestOtp(input.body.email, getClientIp(request));
  return { data: { status: "sent" }, status: 202 };
});
