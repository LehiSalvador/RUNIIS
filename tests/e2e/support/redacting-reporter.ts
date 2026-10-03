import { readFileSync, writeFileSync } from "node:fs";
import type { FullResult, Reporter, TestCase, TestError, TestResult, TestStep } from "@playwright/test/reporter";
import { knownSecrets, redactSecrets } from "./redact";

/**
 * Scrubs every error Playwright is about to report (H2P2-04). It must be the FIRST reporter in
 * playwright.config.ts: the reporters share the same result objects and run in order, so by the time `list` and
 * `html` format an error its message, stack, snippet and cause chain have been redacted in place. It prints nothing.
 *
 * Playwright also writes each failure's errors, unredacted, to an `error-context.md` attachment (test-results and the
 * HTML report copy it); that file is rewritten here too, before any other reporter reads it.
 */
export function redactError(error: TestError | undefined, secrets: readonly string[]): void {
  if (!error) return;
  if (error.message) error.message = redactSecrets(error.message, secrets);
  if (error.stack) error.stack = redactSecrets(error.stack, secrets);
  if (error.snippet) error.snippet = redactSecrets(error.snippet, secrets);
  if (error.value) error.value = redactSecrets(error.value, secrets);
  redactError(error.cause, secrets);
}

/** Rewrites the markdown attachments Playwright generates from the raw errors, in place. Best effort, never throws. */
export function redactErrorContext(result: Pick<TestResult, "attachments">, secrets: readonly string[]): void {
  for (const attachment of result.attachments ?? []) {
    if (attachment.name !== "error-context" || !attachment.path) continue;
    try {
      const raw = readFileSync(attachment.path, "utf8");
      const clean = redactSecrets(raw, secrets);
      if (clean !== raw) writeFileSync(attachment.path, clean, "utf8");
    } catch {
      // The file is a convenience for humans; a missing one leaks nothing.
    }
  }
}

export default class RedactingReporter implements Reporter {
  private readonly secrets: string[];

  constructor(options: { secrets?: string[] } = {}) {
    this.secrets = options.secrets ?? knownSecrets();
  }

  printsToStdio(): boolean {
    return false;
  }

  onStepEnd(_test: TestCase, _result: TestResult, step: TestStep): void {
    redactError(step.error, this.secrets);
  }

  onTestEnd(_test: TestCase, result: TestResult): void {
    for (const error of result.errors) redactError(error, this.secrets);
    redactErrorContext(result, this.secrets);
  }

  onError(error: TestError): void {
    redactError(error, this.secrets);
  }

  onEnd(_result: FullResult): void {}
}
