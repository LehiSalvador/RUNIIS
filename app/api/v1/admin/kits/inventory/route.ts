import { kitInventoryQuerySchema } from "@/lib/server/domain/raceday/contracts";
import { kitCenterInventory } from "@/lib/server/domain/raceday/service";
import { defineRoute } from "@/lib/server/http/handler";

// KIT_PICKUP_RECORD (ADMIN, OPERATOR, CHECKIN) suffices for the read side; KIT_MANAGE is required only
// to mutate (pickup reversal, size change).
export const GET = defineRoute(
  { auth: { staff: ["ADMIN", "OPERATOR", "CHECKIN"] }, input: { query: kitInventoryQuerySchema } },
  async ({ supabase, input }) => ({ data: await kitCenterInventory(supabase, input.query.edition_id) }),
);
