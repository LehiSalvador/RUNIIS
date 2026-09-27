import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const LOCAL_SUPABASE_HOSTS = new Set(["127.0.0.1", "localhost"]);
const LOCAL_SUPABASE_PORT = "54621";

// Values are loaded into process.env only; nothing here prints them.
const envFile = fileURLToPath(new URL("../../.env.development.local", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (!supabaseUrl) throw new Error("Integration tests need NEXT_PUBLIC_SUPABASE_URL (.env.development.local)");
const target = new URL(supabaseUrl);
if (!LOCAL_SUPABASE_HOSTS.has(target.hostname) || target.port !== LOCAL_SUPABASE_PORT) {
  throw new Error(`Integration tests must target local Supabase on port ${LOCAL_SUPABASE_PORT}; got ${target.hostname}:${target.port}`);
}
