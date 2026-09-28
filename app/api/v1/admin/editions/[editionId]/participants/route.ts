import { z } from "zod";
import { participantListQuerySchema } from "@/lib/server/domain/registration/contracts";
import { adminListParticipants } from "@/lib/server/domain/registration/service";
import { defineRoute } from "@/lib/server/http/handler";

const paramsSchema = z.strictObject({ editionId: z.guid() });

// PARTICIPANT_LIST_READ (ADMIN, OPERATOR). Contact fields are included only when the caller also holds
// PII_EXPORT (Master §145); `meta.contact_visible` tells the client whether they were included.
export const GET = defineRoute(
  { auth: { staff: ["ADMIN", "OPERATOR"], editionParam: "editionId" }, input: { params: paramsSchema, query: participantListQuerySchema } },
  async ({ supabase, input }) => {
    const page = await adminListParticipants(supabase, input.params.editionId, input.query);
    return { data: page.items, meta: { next_cursor: page.nextCursor, contact_visible: page.contactVisible } };
  },
);
