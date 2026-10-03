import "server-only";
import { z } from "zod";

// Schemas live in lib/shared/tasks.ts (one definition for the server and the admin UI, SEC-120 strict output validation).
// This module only adds the route-param schemas.

export * from "@/lib/shared/tasks";

export const taskIdParamSchema = z.strictObject({ id: z.guid() });
