"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { CalendarX, CircleAlert, FilterX, RotateCcw, SearchX, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { SearchInput } from "@/components/ui/search-input";
import { Drawer, DrawerContent, DrawerTrigger } from "@/components/ui/drawer";
import { EventCard, type EventCardData } from "@/components/public/event-card";
import { FilterPanel } from "@/components/public/library/filter-panel";
import { cn } from "@/lib/client/cn";
import { EVENT_TYPES, isPastSportDate } from "@/lib/shared/public-event";
import {
  EMPTY_FILTERS,
  LIBRARY_PAGE_SIZE,
  activeFilterCount,
  emptyVariant,
  filterChips,
  libraryHref,
  toQueryString,
  type EventFilters,
} from "@/lib/shared/event-filters";

type Page = { items: EventCardData[]; nextCursor: string | null };
type ApiPage = { data?: { items?: EventCardData[]; next_cursor?: string | null } };

const typeLabel = (key: string) => EVENT_TYPES.find((t) => t.key === key)?.label ?? key;

async function fetchPage(filters: EventFilters, extra: Record<string, string>, signal?: AbortSignal): Promise<Page> {
  const response = await fetch(`/api/v1/events?${toQueryString(filters, extra)}`, {
    headers: { accept: "application/json" },
    signal,
  });
  if (!response.ok) throw new Error(`events ${response.status}`);
  const body = (await response.json()) as ApiPage;
  if (!body.data || !Array.isArray(body.data.items)) throw new Error("events: unexpected body");
  return { items: body.data.items, nextCursor: body.data.next_cursor ?? null };
}

function useNavigate() {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const navigate = React.useCallback(
    (next: EventFilters) => startTransition(() => router.push(libraryHref(next), { scroll: false })),
    [router],
  );
  const refresh = React.useCallback(() => startTransition(() => router.refresh()), [router]);
  return { pending, navigate, refresh };
}

function MobileFilters({ filters, onApply }: { filters: EventFilters; onApply: (next: EventFilters) => void }) {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState(filters);
  const [preview, setPreview] = React.useState<{ state: "idle" | "loading" | "error" } | { state: "done"; count: number; more: boolean }>({ state: "idle" });
  const count = activeFilterCount(filters);
  const draftKey = toQueryString(draft);

  React.useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setPreview({ state: "loading" });
      fetchPage(draft, { limit: "50" }, controller.signal)
        .then((page) => setPreview({ state: "done", count: page.items.length, more: page.nextCursor !== null }))
        .catch(() => {
          if (!controller.signal.aborted) setPreview({ state: "error" });
        });
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
    // draftKey is the canonical serialization of draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, draftKey]);

  const resultLabel =
    preview.state === "done"
      ? preview.count === 0
        ? "Sin resultados"
        : `Ver ${preview.more ? `${preview.count}+` : preview.count} ${preview.count === 1 && !preview.more ? "resultado" : "resultados"}`
      : "Ver resultados";

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(filters);
        setOpen(next);
      }}
    >
      <DrawerTrigger asChild>
        <Button variant="secondary" className="shrink-0 lg:hidden" aria-label={count > 0 ? `Filtros, ${count} activos` : "Filtros"}>
          <SlidersHorizontal className="size-5" aria-hidden="true" />
          Filtros
          {count > 0 ? (
            <span aria-hidden="true" className="ml-0.5 inline-flex size-6 items-center justify-center rounded-full bg-ink text-caption font-semibold text-paper tabular-nums">
              {count}
            </span>
          ) : null}
        </Button>
      </DrawerTrigger>
      <DrawerContent
        title="Filtros"
        side="bottom"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDraft({ ...EMPTY_FILTERS, q: draft.q })}>
              Limpiar filtros
            </Button>
            <Button
              loading={preview.state === "loading"}
              onClick={() => {
                setOpen(false);
                onApply(draft);
              }}
            >
              {resultLabel}
            </Button>
          </>
        }
      >
        <FilterPanel idPrefix="drawer" value={draft} onChange={setDraft} />
        <p aria-live="polite" className="sr-only">
          {preview.state === "done" ? (preview.count === 0 ? "Ningún evento coincide." : `${preview.more ? "Más de " : ""}${preview.count} eventos coinciden.`) : ""}
        </p>
      </DrawerContent>
    </Drawer>
  );
}

function ResultsGrid({ items, priorityFirst }: { items: EventCardData[]; priorityFirst?: boolean }) {
  return (
    <ul className="grid gap-5 md:grid-cols-2 lg:gap-6">
      {items.map((card, index) => (
        <li key={card.edition_id} className="flex">
          <EventCard card={card} headingLevel="h3" priority={priorityFirst && index === 0} className="w-full" />
        </li>
      ))}
    </ul>
  );
}

export function EventLibrary({
  filters,
  initial,
  loadError,
  today,
}: {
  filters: EventFilters;
  initial: Page | null;
  loadError: boolean;
  today: string;
}) {
  const { pending, navigate, refresh } = useNavigate();
  const [items, setItems] = React.useState(initial?.items ?? []);
  const [cursor, setCursor] = React.useState(initial?.nextCursor ?? null);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [moreError, setMoreError] = React.useState(false);
  const [query, setQuery] = React.useState(filters.q ?? "");
  const count = activeFilterCount(filters);
  const chips = filterChips(filters, typeLabel);

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    setMoreError(false);
    try {
      const page = await fetchPage(filters, { cursor, limit: String(LIBRARY_PAGE_SIZE) });
      setItems((current) => {
        const seen = new Set(current.map((card) => card.edition_id));
        return [...current, ...page.items.filter((card) => !seen.has(card.edition_id))];
      });
      setCursor(page.nextCursor);
    } catch {
      setMoreError(true);
    } finally {
      setLoadingMore(false);
    }
  }

  function submitSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const q = query.replace(/\s+/g, " ").trim().slice(0, 160) || null;
    navigate({ ...filters, q });
  }

  const upcoming = items.filter((card) => !isPastSportDate(card.sport_date, today));
  const past = items.filter((card) => isPastSportDate(card.sport_date, today));
  const variant = emptyVariant(filters);

  return (
    <div className="lg:grid lg:grid-cols-12 lg:gap-8">
      <aside aria-labelledby="filtros-titulo" className="hidden lg:col-span-3 lg:block">
        <div className="rounded-card border border-divider bg-paper-raised p-5">
          <div className="mb-4 flex items-center justify-between gap-2">
            <h2 id="filtros-titulo" className="text-h4 font-body font-bold text-ink">
              Filtros
            </h2>
            {count > 0 ? (
              <Button variant="ghost" size="sm" onClick={() => navigate({ ...EMPTY_FILTERS, q: filters.q })}>
                Limpiar
              </Button>
            ) : null}
          </div>
          <FilterPanel idPrefix="sidebar" value={filters} onChange={navigate} />
        </div>
      </aside>

      <div className="lg:col-span-9">
        <div className="flex gap-2">
          <form
            role="search"
            aria-label="Buscar eventos"
            action="/eventos"
            method="get"
            onSubmit={submitSearch}
            className="flex flex-1 gap-2"
          >
            <div className="min-w-0 flex-1">
              <label htmlFor="library-search" className="sr-only">
                Buscar por nombre, ciudad o distancia
              </label>
              <SearchInput
                id="library-search"
                name="q"
                value={query}
                maxLength={160}
                enterKeyHint="search"
                placeholder="Carrera, ciudad o distancia"
                loading={pending}
                onChange={(event) => setQuery(event.target.value)}
                onClear={() => {
                  setQuery("");
                  if (filters.q) navigate({ ...filters, q: null });
                }}
              />
            </div>
            <Button type="submit" variant="primary" className="hidden sm:inline-flex">
              Buscar
            </Button>
          </form>
          <MobileFilters filters={filters} onApply={navigate} />
        </div>

        {chips.length > 0 ? (
          <div className="mt-4 flex items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]">
            <ul aria-label="Filtros aplicados" className="flex gap-2">
              {chips.map((chip) => (
                <li key={chip.id} className="shrink-0">
                  <button
                    type="button"
                    onClick={() => navigate(chip.remove)}
                    className="inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-full border-2 border-lime-deep bg-lime-soft px-3 text-label font-semibold text-ink transition-colors duration-fast ease-standard hover:bg-paper-sunken"
                  >
                    {chip.label}
                    <X className="size-4" aria-hidden="true" />
                    <span className="sr-only">(quitar filtro)</span>
                  </button>
                </li>
              ))}
            </ul>
            <Button variant="ghost" size="sm" className="shrink-0" onClick={() => navigate({ ...EMPTY_FILTERS, q: filters.q })}>
              Limpiar filtros
            </Button>
          </div>
        ) : null}

        <div aria-busy={pending || undefined} className={cn("mt-6 transition-opacity duration-fast ease-standard", pending && "opacity-60")}>
          <p aria-live="polite" className="mb-4 text-body-sm text-ink-60 tabular-nums">
            {loadError ? "" : items.length === 0 ? "" : `${items.length}${cursor ? "+" : ""} ${items.length === 1 && !cursor ? "evento" : "eventos"}${filters.q ? ` para “${filters.q}”` : ""}`}
          </p>

          {loadError ? (
            <div role="alert" className="rounded-card border border-danger-border bg-danger-tint">
              <EmptyState
                icon={CircleAlert}
                headingLevel="h2"
                title="Error cargando eventos"
                description="No pudimos cargar la biblioteca. Es un problema de nuestro lado; tu búsqueda y filtros siguen guardados."
                action={
                  <Button variant="secondary" onClick={refresh} loading={pending}>
                    <RotateCcw className="size-4" aria-hidden="true" />
                    Reintentar
                  </Button>
                }
              />
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-card border border-divider bg-paper-raised">
              {variant === "filters_no_result" ? (
                <EmptyState
                  icon={FilterX}
                  headingLevel="h2"
                  title="Ningún evento coincide con tus filtros"
                  description="Prueba quitando algún filtro o ampliando el rango de fechas o distancia."
                  action={
                    <Button variant="secondary" onClick={() => navigate({ ...EMPTY_FILTERS, q: filters.q })}>
                      Limpiar filtros
                    </Button>
                  }
                />
              ) : variant === "search_no_match" ? (
                <EmptyState
                  icon={SearchX}
                  headingLevel="h2"
                  title={`Sin coincidencias para “${filters.q}”`}
                  description="Revisa la ortografía o busca por ciudad, estado o distancia (por ejemplo, 10K)."
                  action={
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setQuery("");
                        navigate({ ...filters, q: null });
                      }}
                    >
                      Limpiar búsqueda
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  icon={CalendarX}
                  headingLevel="h2"
                  title="No hay próximos eventos"
                  description="Aún no hay carreras publicadas. Vuelve pronto: aquí aparecerán en cuanto se anuncien."
                />
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-12">
              <section aria-labelledby="proximos">
                <h2 id="proximos" className="mb-5 font-display text-h3 font-bold text-ink sm:text-h2">
                  Próximos
                </h2>
                {upcoming.length > 0 ? (
                  <ResultsGrid items={upcoming} priorityFirst />
                ) : (
                  <p className="rounded-card border border-divider bg-paper-raised px-5 py-6 text-body text-ink-80">
                    {count > 0 || filters.q
                      ? "Ningún evento próximo coincide; abajo están los eventos anteriores que sí coinciden."
                      : "No hay próximos eventos por ahora. Abajo puedes consultar los anteriores."}
                  </p>
                )}
              </section>
              {past.length > 0 ? (
                <section aria-labelledby="anteriores" className="border-t border-divider pt-10">
                  <h2 id="anteriores" className="mb-5 font-display text-h3 font-bold text-ink sm:text-h2">
                    Eventos anteriores
                  </h2>
                  <ResultsGrid items={past} />
                </section>
              ) : null}
              <div className="flex flex-col items-center gap-3">
                {moreError ? (
                  <Alert tone="danger" title="No pudimos cargar más eventos" className="w-full">
                    Revisa tu conexión e inténtalo de nuevo.
                  </Alert>
                ) : null}
                <Pagination variant="cursor" hasMore={cursor !== null} loading={loadingMore} onLoadMore={loadMore} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
