import { anonymousReminderBodySchema } from "@/lib/server/domain/communications/contracts";
import { consumeCommunicationRateLimit, requestAnonymousReminder } from "@/lib/server/domain/communications/service";
import { defineRoute } from "@/lib/server/http/handler";
import { getClientIp } from "@/lib/server/http/client-ip";

// POST /api/v1/reminders (Master §130, §176, SEC-082): anonymous "Recordarme" with email confirmation.
// The response is always {accepted:true} regardless of the email's real state (no address oracle);
// IP and per-email SUPPLIED rate limits are consumed here so direct callers cannot brute-force emails.
export const POST = defineRoute({ auth: "public", input: { body: anonymousReminderBodySchema } }, async ({ request, input }) => {
  const email = input.body.email.trim().toLowerCase();
  await consumeCommunicationRateLimit("reminder.anonymous.ip", getClientIp(request));
  await consumeCommunicationRateLimit("reminder.anonymous.email", email);
  return { data: await requestAnonymousReminder(input.body.edition_id, email) };
});
