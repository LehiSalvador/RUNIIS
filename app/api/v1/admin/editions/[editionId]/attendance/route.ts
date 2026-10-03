import type { NextRequest } from "next/server";
import { editionIdParamSchema } from "@/lib/server/domain/closure/contracts";
import { getAttendanceWorkspace } from "@/lib/server/domain/closure/service";
import { AppError } from "@/lib/server/http/errors";
import { defineRoute } from "@/lib/server/http/handler";

// Master §175 / §91-94. ATTENDANCE_MANAGE (ADMIN, OPERATOR); Edition scope from the route param, re-checked by the database.
//
// This GET WRITES (it reconciles the attendance universe under a short Edition lock), so it is never cached and never
// prefetched: the response is `private, no-store` and a speculative request (browser/router prefetch, cross-site fetch)
// is refused. The UI calls it explicitly, as the "open the attendance desk / refresh" action.
function assertExplicitRequest(request: NextRequest): void {
  const purpose = `${request.headers.get("sec-purpose") ?? ""} ${request.headers.get("purpose") ?? ""}`.toLowerCase();
  const prefetch = purpose.includes("prefetch") || request.headers.has("next-router-prefetch") || request.headers.has("x-middleware-prefetch");
  const crossSite = request.headers.get("sec-fetch-site") === "cross-site";
  if (prefetch || crossSite) throw new AppError("FORBIDDEN", { details: { reason: prefetch ? "prefetch_not_allowed" : "cross_site_request" } });
}

export const GET = defineRoute(
  { auth: { staff: ["ADMIN", "OPERATOR"], editionParam: "editionId" }, input: { params: editionIdParamSchema } },
  async ({ request, supabase, input }) => {
    assertExplicitRequest(request);
    return { data: await getAttendanceWorkspace(supabase, input.params.editionId) };
  },
);
