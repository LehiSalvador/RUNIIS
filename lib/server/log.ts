import "server-only";
import { currentRequestId } from "./http/request-id";

type LogValue = string | number | boolean | null | undefined;

// Only scalar fields are accepted so callers cannot dump request bodies, rows or error objects
// (which may carry tokens, SQL text or personal data) into logs.
export function logEvent(level: "info" | "warn" | "error", event: string, fields: Record<string, LogValue> = {}): void {
  const line = JSON.stringify({ level, event, request_id: currentRequestId(), ...fields, at: new Date().toISOString() });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}
