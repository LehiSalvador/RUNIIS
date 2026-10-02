#!/usr/bin/env node
// Local-only helper: set / clear / inspect the Supabase Vault entries that the pg_cron + pg_net worker
// triggers read (supabase/migrations/*_worker_http_triggers.sql). Targets the local Docker database only.
// The secret is read from the app's own env files (or --secret for negative tests) and travels to psql
// over stdin; it is never printed. Run DB-mutating commands under the lock:
//   pnpm db:locked -- node scripts/worker-vault.mjs set [--base-url http://host.docker.internal:3100]
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dbContainer = "supabase_db_RUNIIIS_WEB";
const BASE_NAME = "runiis_worker_base_url";
const SECRET_NAME = "runiis_worker_cron_secret";
const DEFAULT_BASE = "http://host.docker.internal:3100";

const [command, ...rest] = process.argv.slice(2);
const flag = (name) => {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : undefined;
};

function psql(sql) {
  const result = spawnSync("docker", ["exec", "-i", dbContainer, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"], {
    input: sql,
    stdio: ["pipe", "inherit", "inherit"],
  });
  return result.status ?? 1;
}

function readLocalCronSecret() {
  // Same precedence Next.js uses in development.
  for (const name of [".env.development.local", ".env.local", ".env.development", ".env"]) {
    const file = join(root, name);
    if (!existsSync(file)) continue;
    const line = readFileSync(file, "utf8").split(/\r?\n/).find((l) => l.startsWith("INTERNAL_CRON_SECRET="));
    if (!line) continue;
    return line.slice("INTERNAL_CRON_SECRET=".length).trim().replace(/^(['"])(.*)\1$/, "$2");
  }
  throw new Error("INTERNAL_CRON_SECRET not found in the local env files");
}

const lit = (value) => `'${String(value).replaceAll("'", "''")}'`;
const upsert = (name, value, description) => `
do $$ declare v_id uuid; begin
  select id into v_id from vault.secrets where name = ${lit(name)} order by updated_at desc limit 1;
  if v_id is null then perform vault.create_secret(${lit(value)}, ${lit(name)}, ${lit(description)});
  else perform vault.update_secret(v_id, ${lit(value)}, ${lit(name)}, ${lit(description)}); end if;
end $$;`;

if (command === "set") {
  const base = (flag("--base-url") ?? DEFAULT_BASE).replace(/\/+$/, "");
  const secret = flag("--secret") ?? readLocalCronSecret();
  const code = psql(
    upsert(BASE_NAME, base, "RUNIIS worker scheduler: base URL of this environment's app (scheme://host[:port])") +
      upsert(SECRET_NAME, secret, "RUNIIS worker scheduler: INTERNAL_CRON_SECRET of this environment"),
  );
  if (code === 0) console.log(`worker vault set: ${BASE_NAME}=${base}, ${SECRET_NAME}=<redacted>`);
  process.exit(code);
} else if (command === "clear") {
  process.exit(psql(`delete from vault.secrets where name in (${lit(BASE_NAME)}, ${lit(SECRET_NAME)});`));
} else if (command === "status") {
  // Names and lengths only; never the values.
  process.exit(
    psql(`select name, length(decrypted_secret) as value_length, case when name = ${lit(BASE_NAME)} then decrypted_secret else '<redacted>' end as shown
      from vault.decrypted_secrets where name in (${lit(BASE_NAME)}, ${lit(SECRET_NAME)}) order by name;`),
  );
} else {
  console.error("usage: node scripts/worker-vault.mjs <set [--base-url URL] [--secret VALUE]|clear|status>");
  process.exit(2);
}
