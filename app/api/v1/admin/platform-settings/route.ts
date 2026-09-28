import { updatePlatformSettingsBodySchema } from "@/lib/server/domain/events/contracts";
import { adminGetPlatformSettings, updatePlatformSettings } from "@/lib/server/domain/events/service";
import { defineRoute } from "@/lib/server/http/handler";

// PLATFORM_SETTINGS_MANAGE is GLOBAL only (Master §155). Changing defaults never rewrites existing Editions.
export const GET = defineRoute({ auth: { staff: ["ADMIN"] } }, async ({ supabase }) => ({ data: await adminGetPlatformSettings(supabase) }));

export const PATCH = defineRoute(
  { auth: { staff: ["ADMIN"] }, input: { body: updatePlatformSettingsBodySchema } },
  async ({ supabase, input }) => ({ data: await updatePlatformSettings(supabase, input.body) }),
);
