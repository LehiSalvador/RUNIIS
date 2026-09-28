import { getCommunicationMetrics } from "@/lib/server/domain/communications/admin-service";
import { defineRoute } from "@/lib/server/http/handler";

// GET /api/v1/admin/communications/metrics (Master §197): outbox/dispatch/quota health for the console.
export const GET = defineRoute({ auth: { staff: ["ADMIN", "OPERATOR"] } }, async ({ supabase }) => {
  return { data: await getCommunicationMetrics(supabase), headers: { "Cache-Control": "no-store" } };
});
