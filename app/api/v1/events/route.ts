import { mapCta } from "@/lib/server/domain/discovery/cta";
import { searchEditionsQuerySchema } from "@/lib/server/domain/discovery/contracts";
import { searchEditions } from "@/lib/server/domain/discovery/service";
import { defineRoute } from "@/lib/server/http/handler";

// GET /api/v1/events (Master §54-56, §165): public event library search. Cacheable (see
// lib/server/domain/discovery/service.ts); no session, no per-user data.
export const GET = defineRoute({ auth: "public", input: { query: searchEditionsQuerySchema } }, async ({ input }) => {
  const result = await searchEditions(input.query);
  return {
    data: {
      items: result.items.map((card) => ({
        ...card,
        cta: mapCta(card.registration_state, card.execution_state, card.availability?.global_state ?? null),
      })),
      next_cursor: result.nextCursor,
    },
  };
});
