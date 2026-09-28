import { getActiveEventTypes } from "@/lib/server/domain/discovery/service";
import { defineRoute } from "@/lib/server/http/handler";

// GET /api/v1/event-types (Master §165): active event types for the public library filter. Public,
// session-free, cacheable (frontend wraps with the `editions` tag like the other discovery reads —
// see lib/server/domain/discovery/service.ts's module doc comment).
export const GET = defineRoute({ auth: "public" }, async () => ({ data: { items: await getActiveEventTypes() } }));
