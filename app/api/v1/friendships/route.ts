import { friendshipCreateSchema } from "@/lib/server/domain/people/contracts";
import { requestFriendship } from "@/lib/server/domain/people/service";
import { defineRoute } from "@/lib/server/http/handler";

export const POST = defineRoute(
  { auth: "ready", input: { body: friendshipCreateSchema }, idempotency: "optional" },
  async ({ supabase, input, idempotency }) => ({
    data: await requestFriendship(supabase, input.body.public_profile_id, idempotency?.key ?? null),
    status: 201,
  }),
);
