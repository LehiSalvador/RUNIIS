import { getPlatformContact } from "@/lib/server/domain/discovery/service";
import { defineRoute } from "@/lib/server/http/handler";

// GET /api/v1/platform/contact: the effective default WhatsApp number only (ADR A14) — nothing else
// from platform_settings. Public, session-free, cacheable.
export const GET = defineRoute({ auth: "public" }, async () => ({ data: await getPlatformContact() }));
