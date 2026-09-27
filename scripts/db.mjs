#!/usr/bin/env node
// Local Supabase helper. Several agents share one local database, so every operation that
// resets or bulk-writes it runs under a cross-process lock. Never targets a remote project.
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, readFileSync, statSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const lockDir = join(root, ".local-state", "db.lock");
const dbContainer = "supabase_db_RUNIIIS_WEB";
const staleAfterMs = 30 * 60 * 1000;

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function acquireLock(label) {
  const started = Date.now();
  for (;;) {
    try {
      mkdirSync(lockDir, { recursive: false });
      writeFileSync(join(lockDir, "owner.json"), JSON.stringify({ pid: process.pid, label, at: new Date().toISOString() }));
      return;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let ageMs = 0;
      try { ageMs = Date.now() - statSync(lockDir).mtimeMs; } catch { continue; }
      if (ageMs > staleAfterMs) {
        rmSync(lockDir, { recursive: true, force: true });
        continue;
      }
      if (Date.now() - started > 45 * 60 * 1000) throw new Error("Timed out waiting for local DB lock");
      sleep(2000);
    }
  }
}

function releaseLock() {
  rmSync(lockDir, { recursive: true, force: true });
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32", ...options });
  return result.status ?? 1;
}

function withLock(label, fn) {
  acquireLock(label);
  try {
    return fn();
  } finally {
    releaseLock();
  }
}

function psql(sqlArgs, input) {
  return spawnSync("docker", ["exec", "-i", dbContainer, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", ...sqlArgs], {
    cwd: root,
    input,
    stdio: input === undefined ? "inherit" : ["pipe", "inherit", "inherit"],
  }).status ?? 1;
}

const [command, ...rest] = process.argv.slice(2);

const commands = {
  reset: () => withLock("reset", () => run("supabase", ["db", "reset", "--local", ...rest])),
  test: () => withLock("test", () => run("supabase", ["test", "db", ...rest])),
  migrate: () => withLock("migrate", () => run("supabase", ["migration", "up", "--local", ...rest])),
  // Runs an arbitrary command (e.g. an integration suite) while holding the lock.
  locked: () => {
    const separator = rest.indexOf("--");
    const argv = separator >= 0 ? rest.slice(separator + 1) : rest;
    if (argv.length === 0) throw new Error("usage: db.mjs locked -- <command> [args]");
    return withLock(argv.join(" "), () => run(argv[0], argv.slice(1)));
  },
  // SQL against the local database: `db.mjs sql -c "select 1"` or `db.mjs sql -f path.sql`.
  sql: () => {
    const fileIndex = rest.indexOf("-f");
    if (fileIndex >= 0) {
      const file = resolve(root, rest[fileIndex + 1]);
      return psql(rest.filter((_, i) => i !== fileIndex && i !== fileIndex + 1), readFileSync(file, "utf8"));
    }
    return psql(rest);
  },
  "lock-status": () => {
    try {
      console.log(readFileSync(join(lockDir, "owner.json"), "utf8"));
    } catch {
      console.log("unlocked");
    }
    return 0;
  },
  "list-migrations": () => {
    for (const name of readdirSync(join(root, "supabase", "migrations")).sort()) console.log(name);
    return 0;
  },
};

if (!commands[command]) {
  console.error(`usage: node scripts/db.mjs <${Object.keys(commands).join("|")}> [args]`);
  process.exit(2);
}
process.exit(commands[command]());
