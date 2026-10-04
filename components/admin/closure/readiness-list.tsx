import React from "react";
import Link from "next/link";
import { CircleAlert, CircleCheck } from "lucide-react";
import { cn } from "@/lib/client/cn";
import { checkDetail, readinessText } from "@/components/admin/closure/closure-logic";

type Check = { code: string; ok: boolean; detail?: Record<string, unknown> };

/**
 * The server's readiness checks, one row each (never a single toggle): the ones that are NOT ok come first and carry their concrete detail
 * ("3 inscripciones pendientes") and, when a staff screen resolves them, the link to it. The rows are the blocking list: a button that
 * mirrors the readiness is disabled exactly while some row here is failing.
 */
export function ReadinessList({
  title,
  ready,
  checks,
  fixFor,
  headingId,
  testId,
}: {
  title: string;
  ready: boolean;
  checks: readonly Check[];
  fixFor?: (code: string) => { href: string; label: string } | null;
  headingId?: string;
  testId?: string;
}) {
  const failing = checks.filter((check) => !check.ok);
  const passing = checks.filter((check) => check.ok);
  return (
    <div data-testid={testId} data-ready={ready ? "true" : "false"}>
      <p id={headingId} className="flex flex-wrap items-center gap-2 text-body-sm font-semibold text-ink">
        {title}
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-caption font-semibold",
            ready ? "border-success-border bg-success-tint text-success" : "border-warning-border bg-warning-tint text-warning",
          )}
        >
          {ready ? <CircleCheck className="size-3.5" aria-hidden="true" /> : <CircleAlert className="size-3.5" aria-hidden="true" />}
          {ready ? "Lista" : `${failing.length} por resolver`}
        </span>
      </p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {[...failing, ...passing].map((check) => {
          const detail = checkDetail(check);
          const fix = !check.ok ? fixFor?.(check.code) : null;
          return (
            <li key={check.code} className="flex items-start gap-2 text-body-sm" data-check={check.code} data-ok={check.ok ? "true" : "false"}>
              {check.ok ? (
                <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
              ) : (
                <CircleAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" />
              )}
              <span className={check.ok ? "text-ink-80" : "font-semibold text-ink"}>
                <span className="sr-only">{check.ok ? "Cumple: " : "Pendiente: "}</span>
                {readinessText(check.code)}
                {detail ? <span className="block font-normal text-ink-80">{detail}</span> : null}
                {fix ? (
                  <Link href={fix.href} prefetch={false} className="block font-normal underline underline-offset-2">
                    Resolver en {fix.label}
                  </Link>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
