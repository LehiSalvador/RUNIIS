import "server-only";
import { z } from "zod";
import { parseEnv } from "@/lib/shared/env-validation";

const PASS_KEY_NAME = /^PASS_CREDENTIAL_ENCRYPTION_KEY_V([1-9]\d{0,3})$/;
const MIN_SECRET_LENGTH = 32;

const serverEnvSchema = z.object({
  APP_ENV: z.enum(["local", "staging", "production"]),
  APP_BASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  SUPABASE_SECRET_KEY: z.string().min(1),
  PASS_CREDENTIAL_ENCRYPTION_KEY_V1: z.string().min(MIN_SECRET_LENGTH),
  INTERNAL_CRON_SECRET: z.string().min(MIN_SECRET_LENGTH),
});

export type ServerEnv = z.output<typeof serverEnvSchema> & {
  /** Key material by version for every `PASS_CREDENTIAL_ENCRYPTION_KEY_V<n>` present (V1 required). */
  passCredentialKeys: ReadonlyMap<number, string>;
};

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const base = parseEnv(serverEnvSchema, source, "server");
  const passCredentialKeys = new Map<number, string>();
  for (const [name, value] of Object.entries(source)) {
    const version = PASS_KEY_NAME.exec(name)?.[1];
    if (!version) continue;
    if (!value || value.length < MIN_SECRET_LENGTH) throw new Error(`Invalid server environment: ${name}`);
    passCredentialKeys.set(Number(version), value);
  }
  return { ...base, passCredentialKeys };
}

let cached: ServerEnv | undefined;

/** Parsed on first use (never at import time) so builds and unrelated routes do not need secrets. */
export function getServerEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}
