import { manualVerifyBodySchema } from "@/lib/server/domain/raceday/contracts";
import { manualVerifyCheckIn } from "@/lib/server/domain/raceday/service";
import { defineRoute } from "@/lib/server/http/handler";

// PASS_SCAN (SEC-032 MANUAL_VERIFY): staff already resolved the participant via participant search and
// records a reasoned manual check-in when the QR is unavailable.
// actorRateLimit: false -- the race-day desk keeps its own raceday.* limiter (P3SECA-03); the shared staff pre-check must not throttle the desk.
export const POST = defineRoute(
  { auth: { staff: ["ADMIN", "OPERATOR", "CHECKIN"] }, input: { body: manualVerifyBodySchema }, idempotency: "optional", actorRateLimit: false },
  async ({ supabase, input, idempotency }) => ({
    data: await manualVerifyCheckIn(
      supabase,
      input.body.edition_id,
      input.body.participant_pass_id,
      input.body.reason,
      input.body.station_key ?? null,
      idempotency?.key ?? null,
    ),
  }),
);
