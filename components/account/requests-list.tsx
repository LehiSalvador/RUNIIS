"use client";

import React from "react";
import Link from "next/link";
import { Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { toast } from "@/components/ui/use-toast";
import { RequestCard } from "@/components/account/request-card";
import { apiFetch } from "@/lib/client/api";
import { errorMessage } from "@/lib/client/account-errors";
import type { Paged, RequestView } from "@/lib/client/account-types";
import type { RequestStatus } from "@/lib/shared/registration";

type Filter = "ALL" | "PENDING" | "CONFIRMED" | "CLOSED";

const FILTERS: { value: Filter; label: string; matches: (status: RequestStatus) => boolean }[] = [
  { value: "ALL", label: "Todas", matches: () => true },
  { value: "PENDING", label: "Apartadas", matches: (status) => status === "PENDING_CONFIRMATION" },
  { value: "CONFIRMED", label: "Confirmadas", matches: (status) => status === "CONFIRMED" },
  { value: "CLOSED", label: "Canceladas o expiradas", matches: (status) => status !== "PENDING_CONFIRMATION" && status !== "CONFIRMED" },
];

/** ui-spec §4.8 Solicitudes: full history, filterable by the server-derived effective status, 20 per page. */
export function RequestsList({ initial }: { initial: Paged<RequestView> }) {
  const [items, setItems] = React.useState(initial.items);
  const [cursor, setCursor] = React.useState(initial.nextCursor);
  const [loading, setLoading] = React.useState(false);
  const [filter, setFilter] = React.useState<Filter>("ALL");

  async function loadMore() {
    if (!cursor || loading) return;
    setLoading(true);
    const result = await apiFetch<RequestView[], { next_cursor?: string | null }>(`/api/v1/me/registration-requests?${new URLSearchParams({ cursor })}`);
    setLoading(false);
    if (!result.ok) {
      toast({ tone: "danger", title: "No pudimos cargar más solicitudes.", description: errorMessage(result) });
      return;
    }
    setItems((current) => [...current, ...result.data]);
    setCursor(result.meta.next_cursor ?? null);
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon={Inbox}
        headingLevel="h2"
        title="Aún no tienes inscripciones"
        description="Cuando apartes lugares en una carrera, aquí verás el tiempo restante y el estado de tu solicitud."
        action={
          <Button asChild>
            <Link href="/eventos">Explorar carreras</Link>
          </Button>
        }
        className="rounded-card border border-divider bg-paper-raised"
      />
    );
  }

  const active = FILTERS.find((option) => option.value === filter)!;
  const visible = items.filter((request) => active.matches(request.effective_status));

  return (
    <div className="flex flex-col gap-5">
      <div role="group" aria-label="Filtrar solicitudes" className="flex flex-wrap gap-2">
        {FILTERS.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={filter === option.value}
            onClick={() => setFilter(option.value)}
            className={
              filter === option.value
                ? "min-h-11 rounded-full border-2 border-lime-deep bg-paper-raised px-4 text-label font-semibold text-ink"
                : "min-h-11 rounded-full border border-control bg-paper-raised px-4 text-label font-semibold text-ink-80 hover:border-ink-60"
            }
          >
            {option.label}
          </button>
        ))}
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {visible.length} solicitudes
      </p>
      {visible.length === 0 ? (
        <p className="rounded-card border border-dashed border-divider px-5 py-4 text-body-sm text-ink-60">
          No hay solicitudes con este estado{cursor ? " entre las cargadas" : ""}.
        </p>
      ) : (
        <div className="divide-y divide-divider rounded-card border border-divider bg-paper-raised">
          {visible.map((request) => (
            <RequestCard key={request.registration_request_id} request={request} />
          ))}
        </div>
      )}
      <Pagination variant="cursor" hasMore={Boolean(cursor)} loading={loading} onLoadMore={loadMore} />
    </div>
  );
}
