import "server-only";
import { createSystemClient } from "../../supabase/clients";
import type { WorkerHandler } from "../../workers/registry";
import { issuePendingCredentials, passKeyHealth } from "./credentials";

const BATCH = 200;

/** `issue-pending-credentials`: ACTIVE passes of CONFIRMED Registrations without an ACTIVE credential (A1). */
export const issuePendingCredentialsWorker: WorkerHandler = async () => {
  const system = createSystemClient();
  const result = await issuePendingCredentials(system, { limit: BATCH });
  return { ...result, ...(await passKeyHealth(system)) };
};
