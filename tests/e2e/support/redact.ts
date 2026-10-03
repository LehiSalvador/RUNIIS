/**
 * Secret redaction for harness output (H2P2-04).
 *
 * Playwright appends a "Call log" to every API-call failure (timeout, socket error, `toBeOK`) and that log lists
 * every request header, including the defaults merged from `use.extraHTTPHeaders` (the Vercel bypass secret) and
 * the session cookie, plus the response headers (`set-cookie`). Anything that ends up in an error message,
 * stack, step error or report can therefore carry a credential. `redactSecrets` is the single scrubber used by
 * `redacting-reporter.ts` (every error Playwright reports) and by `safe-request.ts` (errors thrown to helpers).
 *
 * Three layers, so that an unknown header or an unknown value still cannot pass through:
 *   1. literal values of every secret the process was given (bypass, Supabase server keys, ...);
 *   2. call-log header lines: only an allow-list of harmless header names keeps its value;
 *   3. credential-shaped strings (Bearer tokens, JWTs, sb_secret_ keys, Supabase auth cookies, header-like JSON).
 * It is pure: no I/O, no environment access (callers pass the secrets).
 */
export const REDACTED = "[redacted]";

/** Environment variables whose values are secrets and must never appear in any output. */
export const SECRET_ENV_NAMES = [
  "E2E_VERCEL_BYPASS",
  "E2E_SUPABASE_SERVER_KEY",
  "SUPABASE_SECRET_KEY",
  "INTERNAL_CRON_SECRET",
  "PASS_CREDENTIAL_ENCRYPTION_KEY_V1",
] as const;

/** Header names whose value is not sensitive and stays readable in a call log (everything else is redacted). */
const SAFE_HEADERS = new Set([
  "accept",
  "accept-encoding",
  "accept-language",
  "access-control-allow-origin",
  "age",
  "cache-control",
  "connection",
  "content-encoding",
  "content-length",
  "content-type",
  "date",
  "etag",
  "keep-alive",
  "retry-after",
  "server",
  "transfer-encoding",
  "user-agent",
  "vary",
  "x-request-id",
  "x-vercel-id",
  "x-vercel-skip-toolbar",
  "x-ratelimit-limit",
  "x-ratelimit-remaining",
]);

// Playwright colours call logs with ANSI escapes.
const ANSI = String.raw`(?:\u001b\[[0-9;]*m)*`;
// "  - user-agent: Playwright/..." (also "<- set-cookie: ..." and "    cookie: ..." shapes inside a call log)
const HEADER_LINE = new RegExp(`^(${ANSI}\\s*(?:[-<>←→]+\\s+)?)([A-Za-z][A-Za-z0-9-]{1,60})(:\\s*)(.*?)(${ANSI})$`);
// "  - -> POST https://host/path?query" / "  - <- 200 OK": the query string can carry tokens, the path never does.
const REQUEST_LINE = new RegExp(`^(${ANSI}\\s*-\\s+[←→]\\s+(?:[A-Z]+\\s+)?)(\\S+)(.*)$`);

const CALL_LOG_START = new RegExp(`^${ANSI}\\s*Call log:`);

const PATTERNS: [RegExp, string][] = [
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, `Bearer ${REDACTED}`],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, REDACTED],
  [/\bsb_secret_[A-Za-z0-9_-]+/g, REDACTED],
  [/\b(sb-[A-Za-z0-9-]*auth-token(?:\.\d+)?|sb-access-token|sb-refresh-token)=[^;\s"',]+/gi, `$1=${REDACTED}`],
  [/(["']?(?:cookie|set-cookie|authorization|proxy-authorization|apikey|x-api-key|x-vercel-protection-bypass)["']?\s*[:=]\s*)(["'])?[^"'\n,}]+/gi, `$1$2${REDACTED}`],
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripQuery(target: string): string {
  const cut = target.search(/[?#]/);
  return cut === -1 ? target : `${target.slice(0, cut)}?${REDACTED}`;
}

/** Scrubs `text`. `secrets` are the literal secret values this process knows (see `knownSecrets`). */
export function redactSecrets(text: string, secrets: readonly string[] = []): string {
  if (!text) return text;
  let out = text;
  for (const secret of secrets) {
    if (secret.length >= 6) out = out.replace(new RegExp(escapeRegExp(secret), "g"), REDACTED);
  }
  // Header and request lines are only rewritten inside a "Call log:" block (it ends at the first blank line), so
  // ordinary messages such as "Error: ..." keep their text.
  let inCallLog = false;
  out = out
    .split("\n")
    .map((line) => {
      if (CALL_LOG_START.test(line)) {
        inCallLog = true;
        return line;
      }
      if (!inCallLog) return line;
      if (line.trim() === "") {
        inCallLog = false;
        return line;
      }
      const header = HEADER_LINE.exec(line);
      if (header && !SAFE_HEADERS.has(header[2].toLowerCase())) return `${header[1]}${header[2]}${header[3]}${REDACTED}${header[5]}`;
      const request = REQUEST_LINE.exec(line);
      if (request) return `${request[1]}${stripQuery(request[2])}${request[3]}`;
      return line;
    })
    .join("\n");
  for (const [pattern, replacement] of PATTERNS) out = out.replace(pattern, replacement);
  return out;
}

/** The secret values present in `env` (names in SECRET_ENV_NAMES). Values shorter than 6 chars are ignored. */
export function knownSecrets(env: Record<string, string | undefined> = process.env): string[] {
  const values: string[] = [];
  for (const name of SECRET_ENV_NAMES) {
    const value = env[name]?.trim();
    if (value && value.length >= 6) values.push(value);
  }
  return values;
}
