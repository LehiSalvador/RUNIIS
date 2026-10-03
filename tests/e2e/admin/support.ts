import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { APIRequestContext, Cookie, Page, TestInfo } from "@playwright/test";
import { psql, signInViaApi, uniqueEmail } from "../support/account";
import { scanForSeriousViolations } from "../support/axe";
import { expect as baseExpect, test as base } from "../support/fixtures";
import { settleNetwork } from "../support/settle";

// The shared dev server compiles routes on first hit and runs real auth/DB round trips.
export const expect = baseExpect.configure({ timeout: 20_000 });

export const EVIDENCE_DIR = ".salvaops-agent-evidence/P3-B-admin-shell-foundation/screens";
mkdirSync(EVIDENCE_DIR, { recursive: true });

/** Seeded local accounts (supabase/seeds/10_auth_users.sql): four staff roles, GLOBAL scope each, plus runner.b (no staff role by default). */
export const ACCOUNTS = {
  admin: "admin@runiis.test",
  operator: "operator@runiis.test",
  checkin: "checkin@runiis.test",
  moderator: "moderator@runiis.test",
  runnerB: "runner.b@runiis.test",
} as const;
export type Account = keyof typeof ACCOUNTS;

/** Seeded published Edition ("Seed Carrera Registro 2026"), supabase/seeds/40_registrations.sql. */
export const SEED_EDITION_ID = "50000000-0000-4000-8000-000000340001";

/**
 * Sessions are cached on disk (system temp, outside the repo) so the three viewport projects, their workers and a
 * re-run within minutes share one sign-in per seeded account instead of each minting an OTP: the local stack allows
 * 1 OTP per 60 s and 5 per hour per email, and GoTrue 1 mail per 60 s per user. The entry is the HttpOnly session
 * cookies of a LOCAL, seeded, synthetic account; it expires after 30 min (the access token lives 1 h, so no refresh
 * rotation ever happens from a cached copy) Tests that sign out use a disposable account instead.
 */
const CACHE_DIR = join(tmpdir(), "runiis-p3b-admin-sessions");
const CACHE_TTL_MS = 30 * 60_000;

function readCached(account: Account): Cookie[] | null {
  try {
    const entry = JSON.parse(readFileSync(join(CACHE_DIR, `${account}.json`), "utf8")) as { at: number; cookies: Cookie[] };
    return Date.now() - entry.at < CACHE_TTL_MS ? entry.cookies : null;
  } catch {
    return null;
  }
}

/** Cross-process mutex (mkdir is atomic): one worker signs a given account in while the others wait for its cache entry. */
async function withAccountLock<T>(account: Account, work: () => Promise<T>): Promise<T> {
  mkdirSync(CACHE_DIR, { recursive: true });
  const lock = join(CACHE_DIR, `${account}.lock`);
  const deadline = Date.now() + 4 * 60_000;
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch {
      try {
        if (Date.now() - statSync(lock).mtimeMs > 3 * 60_000) rmSync(lock, { recursive: true, force: true });
      } catch {
        // released meanwhile
      }
      if (Date.now() > deadline) throw new Error(`timed out waiting for the ${account} sign-in lock`);
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }
  try {
    return await work();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://127.0.0.1:54624";

/** A previous sign-in leaves its code in the mailbox, and the fetch helper takes the first message it sees: purge them. */
async function purgeMailbox(email: string): Promise<void> {
  await fetch(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`, { method: "DELETE" }).catch(() => undefined);
}

function clearEmailBuckets(email: string): void {
  const hash = (subject: string) => `encode(sha256(convert_to('${subject}', 'UTF8')), 'hex')`;
  psql(`
    delete from infra.rate_limit_counter
    where (scope in ('auth.otp.email', 'auth.otp.email.hour.global', 'auth.verify.email.global') and subject = ${hash(email)})
       or (scope in ('auth.otp.email.hour', 'auth.verify.email') and subject = ${hash(`${email}|local-dev`)})`);
}

/**
 * Local OTP limits are per email, and the seeded staff emails are fixed. Local-only, scoped to the seeded address being
 * signed in (never another account's bucket): its own OTP/verify buckets and stale mailbox messages are cleared first,
 * and the signed-in session is reused through the shared cache above.
 */
export async function signInAs(page: Page, account: Account): Promise<void> {
  const reuse = async () => {
    const cached = readCached(account);
    if (cached) await page.context().addCookies(cached);
    return cached !== null;
  };
  if (await reuse()) return;
  await withAccountLock(account, async () => {
    if (await reuse()) return;
    let last: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        clearEmailBuckets(ACCOUNTS[account]);
        await purgeMailbox(ACCOUNTS[account]);
        await signInViaApi(page.request, ACCOUNTS[account]);
        writeFileSync(join(CACHE_DIR, `${account}.json`), JSON.stringify({ at: Date.now(), cookies: await page.context().cookies() }));
        return;
      } catch (error) {
        last = error;
        await new Promise((resolve) => setTimeout(resolve, 1_000 + Math.random() * 2_000));
      }
    }
    throw last;
  });
}

/** A brand-new, disposable non-staff account (its own mailbox and limits): for refusal and sign-out checks. */
export async function signInAsNewUser(page: Page, label: string): Promise<string> {
  const email = uniqueEmail(label);
  await signInViaApi(page.request, email);
  return email;
}

export const test = base.extend<{ evidence: (name: string) => Promise<void>; a11y: () => Promise<void> }>({
  evidence: async ({ page }, provide, testInfo: TestInfo) => {
    await provide(async (name: string) => {
      await page.screenshot({ path: `${EVIDENCE_DIR}/${testInfo.project.name}--${name}.png`, fullPage: true, animations: "disabled" });
    });
  },
  a11y: async ({ page }, provide) => {
    await provide(async () => {
      // Scan settled UI only: a drawer/dialog mid-animation has transient partial opacity (false contrast hits).
      await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== "running"));
      const { serious } = await scanForSeriousViolations(page);
      expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
    });
  },
});

export async function gotoAndSettle(page: Page, path: string) {
  await page.goto(path);
  await settleNetwork(page);
}

/** The visible admin navigation (sidebar at md+, drawer below md), as link names and hrefs. */
export async function openNav(page: Page, projectName: string) {
  if (projectName === "chromium-mobile") await page.getByRole("button", { name: "Abrir menú de administración" }).click();
  return page.getByRole("navigation", { name: "Administración" }).last();
}

export async function navLinks(page: Page, projectName: string): Promise<{ name: string; href: string | null }[]> {
  const nav = await openNav(page, projectName);
  return nav.getByRole("link").evaluateAll((anchors) =>
    anchors.map((anchor) => ({ name: (anchor.textContent ?? "").trim(), href: anchor.getAttribute("href") })),
  );
}

export async function apiStatus(request: APIRequestContext, path: string): Promise<number> {
  return (await request.get(path)).status();
}
