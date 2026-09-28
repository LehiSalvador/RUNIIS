import { z } from "zod";
import { adminRequestListQuerySchema } from "@/lib/server/domain/registration/contracts";
import { adminListRegistrationRequests } from "@/lib/server/domain/registration/service";
import { defineRoute } from "@/lib/server/http/handler";

const paramsSchema = z.strictObject({ editionId: z.guid() });

export const GET = defineRoute(
  { auth: { staff: ["ADMIN", "OPERATOR"], editionParam: "editionId" }, input: { params: paramsSchema, query: adminRequestListQuerySchema } },
  async ({ supabase, input }) => {
    const page = await adminListRegistrationRequests(supabase, input.params.editionId, input.query);
    return { data: page.items, meta: { next_cursor: page.nextCursor, counts: page.counts } };
  },
);
