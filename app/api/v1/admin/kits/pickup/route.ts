import { kitPickupBodySchema } from "@/lib/server/domain/raceday/contracts";
import { recordKitPickup } from "@/lib/server/domain/raceday/service";
import { defineRoute } from "@/lib/server/http/handler";

// KIT_PICKUP_RECORD (ADMIN, OPERATOR, CHECKIN). Scan (credential_token) or manual/third-party
// (registration_id) delivery; always 200 + `outcome`, a duplicate scan never delivers twice (Master §89).
export const POST = defineRoute(
  { auth: { staff: ["ADMIN", "OPERATOR", "CHECKIN"] }, input: { body: kitPickupBodySchema }, idempotency: "optional" },
  async ({ supabase, input, idempotency }) => ({
    data: await recordKitPickup(supabase, {
      editionId: input.body.edition_id,
      kitDefinitionId: input.body.kit_definition_id,
      credentialToken: input.body.credential_token,
      registrationId: input.body.registration_id,
      stationKey: input.body.station_key ?? null,
      thirdParty: input.body.third_party ?? false,
      thirdPartyReason: input.body.third_party_reason ?? null,
      idempotencyKey: idempotency?.key ?? null,
    }),
  }),
);
