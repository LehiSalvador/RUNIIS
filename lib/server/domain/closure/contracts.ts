import "server-only";
import { z } from "zod";

// Output and input schemas live in lib/shared/closure.ts (one definition for the server and the admin UI,
// SEC-120 strict output validation). This module only adds the route-param schemas.

export * from "@/lib/shared/closure";

export const editionIdParamSchema = z.strictObject({ editionId: z.guid() });
export const registrationIdParamSchema = z.strictObject({ id: z.guid() });
