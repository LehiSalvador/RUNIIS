import { existsSync } from "node:fs";
import { afterAll } from "vitest";
import { fileURLToPath } from "node:url";
import { purgeTestLegalDocuments } from "./helpers";

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

// Test hygiene (P3-AC-19): whatever a file publishes under the IT_TEST_DOC_ prefix is global to the shared local database, so it is removed
// when the file ends, also when a test failed half way (afterAll runs either way). Files that publish one clean up earlier themselves.
afterAll(() => {
  purgeTestLegalDocuments();
});
