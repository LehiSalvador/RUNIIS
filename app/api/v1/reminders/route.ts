import { anonymousReminderBodySchema } from "@/lib/server/domain/communications/contracts";
import { verifyReminderCaptcha } from "@/lib/server/domain/communications/captcha";
import { consumeCommunicationRateLimit, requestAnonymousReminder } from "@/lib/server/domain/communications/service";
import { defineRoute } from "@/lib/server/http/handler";
import { AppError } from "@/lib/server/http/errors";
import { getClientIp } from "@/lib/server/http/client-ip";

// POST /api/v1/reminders (Master §130, §176, SEC-082): anonymous "Recordarme" with email confirmation.
// The response is always {accepted:true} regardless of the email's real state (no address oracle);
// the ALTCHA proof-of-work is verified first -- fail closed with no rate-limit consumption and no
// enqueue on a missing/invalid/replayed solve (F1) -- then IP and per-email SUPPLIED rate limits are
// consumed so direct callers cannot brute-force emails even with a valid solve.
export const POST = defineRoute({ auth: "public", input: { body: anonymousReminderBodySchema } }, async ({ request, input }) => {
  if (!(await verifyReminderCaptcha(input.body.altcha))) {
    throw new AppError("VALIDATION_ERROR", { details: { field: "altcha" } });
  }
  const email = input.body.email.trim().toLowerCase();
  await consumeCommunicationRateLimit("reminder.anonymous.ip", getClientIp(request));
  await consumeCommunicationRateLimit("reminder.anonymous.email", email);
  return { data: await requestAnonymousReminder(input.body.edition_id, email) };
});
