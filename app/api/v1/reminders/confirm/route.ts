import { confirmTokenBodySchema } from "@/lib/server/domain/communications/contracts";
import { confirmAnonymousReminder, consumeCommunicationRateLimit } from "@/lib/server/domain/communications/service";
import { defineRoute } from "@/lib/server/http/handler";
import { getClientIp } from "@/lib/server/http/client-ip";

// POST /api/v1/reminders/confirm (Master §176): POST-only confirmation from the landing page the
// confirmation email links to (never a GET, so link-prefetching scanners cannot burn the token).
// Unknown, used and expired tokens are indistinguishable (RESOURCE_EXPIRED, generic message).
export const POST = defineRoute({ auth: "public", input: { body: confirmTokenBodySchema } }, async ({ request, input }) => {
  await consumeCommunicationRateLimit("reminder.confirm.ip", getClientIp(request));
  return { data: await confirmAnonymousReminder(input.body.token) };
});
