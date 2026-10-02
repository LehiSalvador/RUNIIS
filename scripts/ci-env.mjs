#!/usr/bin/env node
// CI helper: writes .env.development.local for the integration job from the running local Supabase stack
// (`supabase status -o json`) plus freshly generated throw-away secrets. Nothing here reaches stdout:
// the file is gitignored (`.env.*`), the stack is the ephemeral runner's own, and no GitHub secret is used.
// Refuses to run outside CI so it can never overwrite a developer's real .env.development.local.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const target = join(root, ".env.development.local");

if (process.env.CI !== "true") {
  console.error("ci-env: refusing to write .env.development.local outside CI (set CI=true to force).");
  process.exit(2);
}
if (existsSync(target)) {
  console.error("ci-env: .env.development.local already exists; refusing to overwrite it.");
  process.exit(2);
}

const status = spawnSync("supabase", ["status", "-o", "json"], { cwd: root, encoding: "utf8", shell: process.platform === "win32" });
if (status.status !== 0) {
  console.error("ci-env: `supabase status` failed; is the local stack running?");
  process.exit(1);
}

let stack;
try {
  stack = JSON.parse(status.stdout.slice(status.stdout.indexOf("{")));
} catch {
  console.error("ci-env: could not parse `supabase status -o json` output.");
  process.exit(1);
}

const required = { API_URL: stack.API_URL, PUBLISHABLE_KEY: stack.PUBLISHABLE_KEY, SECRET_KEY: stack.SECRET_KEY };
const missing = Object.entries(required).filter(([, value]) => !value).map(([name]) => name);
if (missing.length > 0) {
  console.error(`ci-env: supabase status is missing: ${missing.join(", ")}`);
  process.exit(1);
}

const secret = () => randomBytes(32).toString("hex");
const lines = [
  "APP_ENV=local",
  "APP_BASE_URL=http://127.0.0.1:3100",
  `NEXT_PUBLIC_SUPABASE_URL=${stack.API_URL}`,
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${stack.PUBLISHABLE_KEY}`,
  `SUPABASE_SECRET_KEY=${stack.SECRET_KEY}`,
  `PASS_CREDENTIAL_ENCRYPTION_KEY_V1=${secret()}`,
  `INTERNAL_CRON_SECRET=${secret()}`,
  "EMAIL_DELIVERY_MODE=capture",
  `MAILPIT_URL=${stack.MAILPIT_URL ?? stack.INBUCKET_URL ?? "http://127.0.0.1:54624"}`,
  "",
];
// Mask before anything could log them: the runner redacts these values in every later step's output.
if (process.env.GITHUB_ACTIONS === "true") {
  for (const value of [stack.PUBLISHABLE_KEY, stack.SECRET_KEY]) console.log(`::add-mask::${value}`);
}
writeFileSync(target, lines.join("\n"), { mode: 0o600 });
console.log("ci-env: wrote .env.development.local (values not printed).");
