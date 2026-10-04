"use client";

import React from "react";
import type { ApiFailure } from "@/lib/client/api";
import { ErrorNoticeView } from "@/components/admin/error-notice";
import { describeFailure, type AdminErrorView } from "@/components/admin/errors";
import { describeRequestFailure } from "@/components/admin/requests/request-logic";

/**
 * A refused queue action: the shared actionable error (kind, support reference, retry or reload) with the request-specific copy of
 * J2 (price changed, missing acceptance, no capacity, request already closed) laid over it, plus one line per blocking participant.
 * Never renders server text: only codes and the details the contract names.
 */
export function RequestFailureNotice({
  failure,
  participants,
  onRetry,
  className,
}: {
  failure: Pick<ApiFailure, "code" | "requestId" | "details">;
  participants?: readonly { display_name: string | null }[];
  onRetry?: () => void;
  className?: string;
}) {
  const base = describeFailure(failure);
  const specific = describeRequestFailure(failure, participants ?? []);
  const view: AdminErrorView = specific
    ? { ...base, title: specific.title, message: specific.message, action: specific.refreshes ? "reload" : base.action === "retry" ? "retry" : "none" }
    : base;
  return (
    <div className={className} data-testid="request-failure">
      <ErrorNoticeView view={view} onRetry={onRetry} />
      {specific && specific.lines.length > 0 ? (
        <ul className="mt-2 list-disc space-y-0.5 pl-6 text-body-sm text-ink-80" aria-label="Qué bloquea la confirmación">
          {specific.lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
