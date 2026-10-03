import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request, type APIRequestContext } from "@playwright/test";
import type { TestCase, TestError, TestResult, TestStep } from "@playwright/test/reporter";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { knownSecrets, REDACTED, redactSecrets } from "../../e2e/support/redact";
import RedactingReporter from "../../e2e/support/redacting-reporter";
import { ApiCallError, failureReason, safeApi } from "../../e2e/support/safe-request";

// H2P2-04: a failing API call must never print the bypass secret, a cookie or another header. The control proves
// the premise against a REAL Playwright APIRequestContext (its error carries every request header); the rest proves
// the scrubber, the reporter and the helper wrapper. Secrets are built at runtime so no literal lives in the tree.
const BYPASS = ["synthetic", "bypass", Math.random().toString(16).slice(2, 12)].join("-");
const COOKIE = ["sb-synthetic-auth-token", Math.random().toString(16).slice(2, 12)].join("-");
const SERVER_KEY = ["synthetic", "server", Math.random().toString(16).slice(2, 12)].join("-");
const SECRETS = [BYPASS, SERVER_KEY];

function leaks(text: string): string[] {
  return [BYPASS, COOKIE, SERVER_KEY, "Bearer synthetic", "x-vercel-protection-bypass: synthetic"].filter((needle) => text.includes(needle));
}

describe("a real Playwright API failure", () => {
  let hangup: Server;
  let silent: Server;
  let context: APIRequestContext;
  let hangupUrl: string;
  let silentUrl: string;

  beforeAll(async () => {
    hangup = createServer((req) => req.socket.destroy());
    silent = createServer(() => {});
    await Promise.all([hangup, silent].map((server) => new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))));
    hangupUrl = `http://127.0.0.1:${(hangup.address() as AddressInfo).port}`;
    silentUrl = `http://127.0.0.1:${(silent.address() as AddressInfo).port}`;
    context = await request.newContext({ baseURL: hangupUrl, extraHTTPHeaders: { "x-vercel-protection-bypass": BYPASS } });
  });

  afterAll(async () => {
    await context.dispose();
    await Promise.all([hangup, silent].map((server) => new Promise((resolve) => server.close(resolve))));
  });

  async function capture(call: () => Promise<unknown>): Promise<Error> {
    try {
      await call();
    } catch (error) {
      return error as Error;
    }
    throw new Error("expected the call to fail");
  }

  const withCredentials = { headers: { cookie: `${COOKIE}=1`, authorization: "Bearer synthetic-token-value" }, data: { x: 1 } };

  test("CONTROL: Playwright's own error does carry the bypass secret, the cookie and the authorization header", async () => {
    const error = await capture(() => context.post("/api/v1/me/onboarding?token=abc", withCredentials));
    expect(error.message).toContain(BYPASS);
    expect(error.message).toContain(COOKIE);
    expect(error.message).toContain("Bearer synthetic-token-value");
  });

  test("redactSecrets removes every credential from that error and keeps it diagnosable", async () => {
    const error = await capture(() => context.post("/api/v1/me/onboarding?token=abc", withCredentials));
    const clean = redactSecrets(`${error.message}\n${error.stack ?? ""}`, SECRETS);
    expect(leaks(clean)).toEqual([]);
    expect(clean).not.toContain("token=abc");
    expect(clean).toContain("socket hang up");
    expect(clean).toContain("POST");
    expect(clean).toContain("/api/v1/me/onboarding");
    expect(clean).toContain("user-agent: Playwright");
    expect(clean).toContain(`x-vercel-protection-bypass: ${REDACTED}`);
  });

  test("a timeout (no response at all) is scrubbed too", async () => {
    const error = await capture(() => context.get(`${silentUrl}/slow`, { timeout: 250 }));
    expect(error.message).toContain(BYPASS);
    const clean = redactSecrets(error.message, SECRETS);
    expect(leaks(clean)).toEqual([]);
    expect(clean).toContain("Timeout 250ms exceeded");
  });

  test("an UNKNOWN secret header is redacted by the call-log allow-list even when its value is not a known secret", async () => {
    const error = await capture(() => context.get("/x", { headers: { "x-some-future-token": "opaque-value-123456" } }));
    expect(error.message).toContain("opaque-value-123456");
    expect(redactSecrets(error.message, [])).not.toContain("opaque-value-123456");
  });

  test("safeApi reports method, path and reason only", async () => {
    const error = await capture(() => safeApi(context).post("/api/v1/me/onboarding?token=abc", withCredentials));
    expect(error).toBeInstanceOf(ApiCallError);
    expect(error.message).toBe("API POST /api/v1/me/onboarding failed: socket hang up");
    expect(leaks(error.message + (error.stack ?? ""))).toEqual([]);
    expect((error as { cause?: unknown }).cause).toBeUndefined();
  });

  test("safeApi passes responses and other members through untouched", async () => {
    const ok = createServer((_req, res) => res.writeHead(201, { "content-type": "application/json" }).end('{"ok":true}'));
    await new Promise<void>((resolve) => ok.listen(0, "127.0.0.1", resolve));
    const probe = await request.newContext({ baseURL: `http://127.0.0.1:${(ok.address() as AddressInfo).port}`, extraHTTPHeaders: { "x-vercel-protection-bypass": BYPASS } });
    try {
      const response = await safeApi(probe).get("/fine");
      expect(response.status()).toBe(201);
      expect(await response.json()).toEqual({ ok: true });
      expect(typeof safeApi(probe).dispose).toBe("function");
    } finally {
      await probe.dispose();
      await new Promise((resolve) => ok.close(resolve));
    }
  });

  test("failureReason never returns more than the first line, even for an unknown error shape", () => {
    expect(failureReason(new Error("apiRequestContext.get: Timeout 1ms exceeded.\nCall log:\n  - cookie: sb=1"), [])).toBe("Timeout 1ms exceeded.");
    expect(failureReason("plain string", [])).toBe("plain string");
    expect(failureReason(undefined, [])).toBe("undefined");
  });
});

describe("redactSecrets", () => {
  test("literal secrets go wherever they appear; short values are ignored", () => {
    expect(redactSecrets(`a ${BYPASS} b ${BYPASS}`, [BYPASS])).toBe(`a ${REDACTED} b ${REDACTED}`);
    expect(redactSecrets("abc is fine", ["abc"])).toBe("abc is fine");
  });

  test("credential shapes are scrubbed without any known secret", () => {
    const jwt = ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxMjM0NTY3ODkwIn0", "c2lnbmF0dXJl"].join(".");
    const text = `Authorization: Bearer abcdefghijkl1234, token ${jwt}, key sb_secret_abcdef123456, cookie sb-proj-auth-token=abc.def; Path=/`;
    const clean = redactSecrets(text, []);
    for (const needle of ["abcdefghijkl1234", jwt, "sb_secret_abcdef123456", "abc.def"]) expect(clean).not.toContain(needle);
    expect(clean).toContain("Path=/");
  });

  test("header-shaped JSON (an assertion that printed headers) is scrubbed", () => {
    const clean = redactSecrets(JSON.stringify({ headers: { cookie: "a=1", "x-vercel-protection-bypass": "zzzzzzzz", accept: "*/*" } }), []);
    expect(clean).not.toContain("a=1");
    expect(clean).not.toContain("zzzzzzzz");
    expect(clean).toContain("*/*");
  });

  test("ordinary messages and text outside a call log are left alone", () => {
    const message = "Error: expect(received).toBe(expected)\n\nExpected: 200\nReceived: 500\n\nCall log:\n  - → GET http://x/y?z=1\n    - accept: */*\n    - set-cookie: a=b\n\nnext paragraph: kept";
    const clean = redactSecrets(message, []);
    expect(clean).toContain("Expected: 200");
    expect(clean).toContain("next paragraph: kept");
    expect(clean).toContain("accept: */*");
    expect(clean).not.toContain("a=b");
    expect(clean).not.toContain("z=1");
  });

  test("knownSecrets reads only the secret variables and skips short or empty values", () => {
    expect(knownSecrets({ E2E_VERCEL_BYPASS: "  long-enough-secret ", E2E_SUPABASE_SERVER_KEY: "x", SUPABASE_SECRET_KEY: "", E2E_BASE_URL: "https://staging.runiismty.com" })).toEqual(["long-enough-secret"]);
  });
});

describe("redacting reporter", () => {
  const reporter = new RedactingReporter({ secrets: SECRETS });
  const leaky = (): TestError => ({
    message: `apiRequestContext.post: socket hang up\nCall log:\n  - → POST http://h/x\n    - x-vercel-protection-bypass: ${BYPASS}\n    - cookie: ${COOKIE}=1`,
    stack: `Error: ${BYPASS}`,
    snippet: `> 1 | ${SERVER_KEY}`,
    cause: { message: `inner ${BYPASS}` },
  });

  test("scrubs message, stack, snippet and cause of every error of a finished test, in place", () => {
    const result = { errors: [leaky(), leaky()] } as unknown as TestResult;
    reporter.onTestEnd({} as TestCase, result);
    expect(leaks(JSON.stringify(result.errors))).toEqual([]);
    expect(result.errors[0].message).toContain("socket hang up");
  });

  test("scrubs step errors and global errors", () => {
    const step = { error: leaky() } as unknown as TestStep;
    reporter.onStepEnd({} as TestCase, {} as TestResult, step);
    expect(leaks(JSON.stringify(step.error))).toEqual([]);
    const global = leaky();
    reporter.onError(global);
    expect(leaks(JSON.stringify(global))).toEqual([]);
  });

  test("rewrites the error-context.md attachment Playwright writes from the raw errors", () => {
    const path = join(mkdtempSync(join(tmpdir(), "redaction-")), "error-context.md");
    writeFileSync(path, `# Test failed

\`\`\`
Call log:
  - → POST http://h/x?token=1
    - x-vercel-protection-bypass: ${BYPASS}
    - cookie: ${COOKIE}=1
\`\`\`
`);
    const unrelated = join(tmpdir(), "not-touched.md");
    reporter.onTestEnd({} as TestCase, { errors: [], attachments: [{ name: "error-context", contentType: "text/markdown", path }, { name: "other", contentType: "text/markdown", path: unrelated }] } as unknown as TestResult);
    const clean = readFileSync(path, "utf8");
    expect(leaks(clean)).toEqual([]);
    expect(clean).toContain("# Test failed");
  });

  test("tolerates a step or a result without errors and prints nothing", () => {
    expect(() => reporter.onStepEnd({} as TestCase, {} as TestResult, {} as TestStep)).not.toThrow();
    expect(() => reporter.onTestEnd({} as TestCase, { errors: [] } as unknown as TestResult)).not.toThrow();
    expect(reporter.printsToStdio()).toBe(false);
  });
});

describe("harness configuration", () => {
  test("the redacting reporter is the first reporter, so it runs before list and html format an error", () => {
    const config = readFileSync(join(process.cwd(), "playwright.config.ts"), "utf8");
    const reporters = /reporter:\s*\[(.*)\],/.exec(config)?.[1] ?? "";
    expect(reporters.trimStart().startsWith('["./tests/e2e/support/redacting-reporter.ts"]')).toBe(true);
    expect(reporters).toContain('"list"');
    expect(reporters).toContain('"html"');
  });

  test("no spec or helper uses toBeOK(): its failure message prints the response headers", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(entry) && /\.toBeOK\(/.test(readFileSync(path, "utf8"))) offenders.push(path);
      }
    };
    walk(join(process.cwd(), "tests", "e2e"));
    expect(offenders).toEqual([]);
  });
});
