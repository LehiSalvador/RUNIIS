import { workerRegistry } from "@/lib/server/workers/registry";
import { createWorkerRoute } from "@/lib/server/workers/route";

export const POST = createWorkerRoute(workerRegistry);
