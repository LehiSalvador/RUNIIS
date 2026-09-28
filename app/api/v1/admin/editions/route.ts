import { z } from "zod";
import { createEditionBodySchema } from "@/lib/server/domain/events/contracts";
import { createEdition } from "@/lib/server/domain/events/service";
import { defineRoute } from "@/lib/server/http/handler";

const bodySchema = createEditionBodySchema.extend({ event_id: z.guid() });

// EDITION_CREATE is GLOBAL only (Master §28).
export const POST = defineRoute(
  { auth: { staff: ["ADMIN"] }, input: { body: bodySchema }, idempotency: "optional" },
  async ({ supabase, input, idempotency }) => {
    const { event_id, ...body } = input.body;
    return { data: await createEdition(supabase, event_id, body, idempotency?.key ?? null), status: 201 };
  },
);
