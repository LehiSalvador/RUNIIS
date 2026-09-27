import type { z } from "zod";

// Env validation errors name the offending variables only; values are never echoed.
export function parseEnv<S extends z.ZodType>(schema: S, source: unknown, label: string): z.output<S> {
  const result = schema.safeParse(source);
  if (result.success) return result.data;
  const names = [...new Set(result.error.issues.map((issue) => String(issue.path[0] ?? "?")))];
  throw new Error(`Invalid ${label} environment: ${names.join(", ")}`);
}
