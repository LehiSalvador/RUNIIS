import { createReminderChallenge } from "@/lib/server/domain/communications/captcha";
import { defineRoute } from "@/lib/server/http/handler";

// GET /api/v1/reminders/challenge (F1/SEC-082): issues a fresh self-hosted ALTCHA proof-of-work
// challenge for the anonymous reminder widget (a later frontend task). Public, session-free, never
// cached -- a cached challenge would be handed out to many clients, defeating the per-solve cost.
export const GET = defineRoute({ auth: "public" }, async () => ({
  data: await createReminderChallenge(),
  headers: { "Cache-Control": "no-store" },
}));
