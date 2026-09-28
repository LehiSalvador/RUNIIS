import { z } from "zod";
import { renderMyPassQrSvg } from "@/lib/server/domain/passes/service";
import { defineRoute } from "@/lib/server/http/handler";

const paramsSchema = z.strictObject({ passId: z.guid() });

// SEC-011/033: the SVG is generated fresh per request and never cached or logged with the token.
export const POST = defineRoute({ auth: "ready", input: { params: paramsSchema } }, async ({ supabase, input }) => {
  const svg = await renderMyPassQrSvg(supabase, input.params.passId);
  return new Response(svg, {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
