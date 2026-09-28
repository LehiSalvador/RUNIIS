"use client";

import React from "react";
import { SearchX, UserPlus, Users } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { SearchInput } from "@/components/ui/search-input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/use-toast";
import { ConfirmDialog } from "@/components/account/confirm-dialog";
import { RowList } from "@/components/account/section";
import { apiFetch, newIdempotencyKey, type ApiFailure } from "@/lib/client/api";
import { errorMessage } from "@/lib/client/account-errors";
import { formatDateTime } from "@/lib/client/account-format";
import type { FriendshipState, FriendshipView, Paged, PersonSearchItem } from "@/lib/client/account-types";

export type FriendsTab = "amigos" | "recibidas" | "enviadas" | "buscar";
type ListKey = "friends" | "incoming" | "outgoing";
type Lists = Record<ListKey, Paged<FriendshipView>>;

const VIEW: Record<ListKey, "FRIENDS" | "INCOMING" | "OUTGOING"> = { friends: "FRIENDS", incoming: "INCOMING", outgoing: "OUTGOING" };
const SEARCH_DEBOUNCE_MS = 350;

function friendshipFailure(failure: ApiFailure): string {
  if (failure.code === "RATE_LIMITED") return "Enviaste muchas solicitudes seguidas. Espera un momento antes de enviar otra.";
  if (failure.code === "CONFLICT") return "La amistad cambió mientras tanto. Actualizamos la lista.";
  if (failure.code === "NOT_FOUND") return "Esta persona ya no está disponible.";
  return errorMessage(failure);
}

async function fetchPage(key: ListKey, cursor?: string) {
  const query = new URLSearchParams({ view: VIEW[key] });
  if (cursor) query.set("cursor", cursor);
  return apiFetch<FriendshipView[], { next_cursor?: string | null }>(`/api/v1/me/friends?${query}`);
}

function PersonLine({ name, meta }: { name: string; meta?: string }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar displayName={name} size={40} decorative />
      <div className="min-w-0">
        <p className="truncate text-body font-semibold text-ink">{name}</p>
        {meta ? <p className="truncate text-caption text-ink-60">{meta}</p> : null}
      </div>
    </div>
  );
}

/**
 * J9 friends: lists (friends / incoming / outgoing, cursor-paged 20 per page) and people search
 * (session-only, debounced, 20 per page). Every mutation re-reads the three lists from the API so
 * the counters never drift from the server; search rows update their own friendship state.
 */
export function FriendsManager({ initial, initialTab }: { initial: Lists; initialTab: FriendsTab }) {
  const [tab, setTab] = React.useState<FriendsTab>(initialTab);
  const [lists, setLists] = React.useState<Lists>(initial);
  const [loadingMore, setLoadingMore] = React.useState<ListKey | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = React.useState<FriendshipView | null>(null);

  async function reloadLists() {
    const results = await Promise.all((Object.keys(VIEW) as ListKey[]).map((key) => fetchPage(key)));
    setLists((current) => {
      const next = { ...current };
      (Object.keys(VIEW) as ListKey[]).forEach((key, index) => {
        const result = results[index];
        if (result.ok) next[key] = { items: result.data, nextCursor: result.meta.next_cursor ?? null };
      });
      return next;
    });
  }

  async function loadMore(key: ListKey) {
    const cursor = lists[key].nextCursor;
    if (!cursor || loadingMore) return;
    setLoadingMore(key);
    const result = await fetchPage(key, cursor);
    setLoadingMore(null);
    if (!result.ok) {
      toast({ tone: "danger", title: "No pudimos cargar más.", description: errorMessage(result) });
      return;
    }
    setLists((current) => ({
      ...current,
      [key]: { items: [...current[key].items, ...result.data], nextCursor: result.meta.next_cursor ?? null },
    }));
  }

  async function respond(friendship: FriendshipView, answer: "accept" | "reject") {
    if (busy) return;
    setBusy(friendship.friendship_id);
    const result = await apiFetch(`/api/v1/friendships/${friendship.friendship_id}/${answer}`, { method: "POST" });
    setBusy(null);
    if (!result.ok) toast({ tone: "danger", title: "No se pudo responder.", description: friendshipFailure(result) });
    else
      toast({
        tone: answer === "accept" ? "success" : "info",
        title: answer === "accept" ? `Ahora eres amistad de ${friendship.counterpart?.display_name ?? "esta persona"}` : "Solicitud rechazada",
      });
    await reloadLists();
  }

  async function remove(friendship: FriendshipView): Promise<ApiFailure | null> {
    const result = await apiFetch(`/api/v1/friendships/${friendship.friendship_id}`, { method: "DELETE" });
    if (!result.ok) return result;
    toast({ tone: "info", title: friendship.status === "PENDING" ? "Solicitud cancelada" : "Amistad eliminada" });
    await reloadLists();
    return null;
  }

  const counts = { friends: lists.friends.items.length, incoming: lists.incoming.items.length, outgoing: lists.outgoing.items.length };
  const countLabel = (count: number, more: boolean) => (count > 0 ? ` (${count}${more ? "+" : ""})` : "");

  return (
    <>
      <Tabs value={tab} onValueChange={(value) => setTab(value as FriendsTab)}>
        <TabsList aria-label="Secciones de amigos" className="overflow-x-auto">
          <TabsTrigger value="amigos">Amigos{countLabel(counts.friends, Boolean(lists.friends.nextCursor))}</TabsTrigger>
          <TabsTrigger value="recibidas">Recibidas{countLabel(counts.incoming, Boolean(lists.incoming.nextCursor))}</TabsTrigger>
          <TabsTrigger value="enviadas">Enviadas{countLabel(counts.outgoing, Boolean(lists.outgoing.nextCursor))}</TabsTrigger>
          <TabsTrigger value="buscar">Buscar personas</TabsTrigger>
        </TabsList>

        <TabsContent value="amigos" className="pt-6 outline-none">
          {lists.friends.items.length === 0 ? (
            <EmptyState
              icon={Users}
              title="Todavía no tienes amistades"
              description="Busca a tus compañeros de carrera para inscribirlos contigo."
              action={<Button onClick={() => setTab("buscar")}>Buscar personas</Button>}
              className="rounded-card border border-divider bg-paper-raised"
            />
          ) : (
            <>
              <RowList label="Amistades">
                {lists.friends.items.map((friendship) => (
                  <li key={friendship.friendship_id} className="flex items-center justify-between gap-3 p-4" data-testid="friend-row">
                    <PersonLine name={friendship.counterpart?.display_name ?? "Persona"} meta={`Amistad desde ${formatDateTime(friendship.responded_at ?? friendship.requested_at)}`} />
                    <Button variant="ghost" size="sm" onClick={() => setRemoveTarget(friendship)}>
                      Eliminar<span className="sr-only"> a {friendship.counterpart?.display_name}</span>
                    </Button>
                  </li>
                ))}
              </RowList>
              <Pagination variant="cursor" hasMore={Boolean(lists.friends.nextCursor)} loading={loadingMore === "friends"} onLoadMore={() => loadMore("friends")} className="mt-4" />
            </>
          )}
        </TabsContent>

        <TabsContent value="recibidas" className="pt-6 outline-none">
          {lists.incoming.items.length === 0 ? (
            <EmptyState icon={UserPlus} title="No tienes solicitudes por responder" description="Cuando alguien quiera agregarte, aparecerá aquí." className="rounded-card border border-divider bg-paper-raised" />
          ) : (
            <>
              <RowList label="Solicitudes recibidas">
                {lists.incoming.items.map((friendship) => {
                  const name = friendship.counterpart?.display_name ?? "Persona";
                  return (
                    <li key={friendship.friendship_id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between" data-testid="incoming-row">
                      <PersonLine name={name} meta={`Te la envió el ${formatDateTime(friendship.requested_at)}`} />
                      <div className="flex gap-2">
                        <Button size="sm" loading={busy === friendship.friendship_id} disabled={busy !== null} onClick={() => respond(friendship, "accept")} className="flex-1 sm:flex-none">
                          Aceptar<span className="sr-only"> a {name}</span>
                        </Button>
                        <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => respond(friendship, "reject")} className="flex-1 sm:flex-none">
                          Rechazar<span className="sr-only"> a {name}</span>
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </RowList>
              <Pagination variant="cursor" hasMore={Boolean(lists.incoming.nextCursor)} loading={loadingMore === "incoming"} onLoadMore={() => loadMore("incoming")} className="mt-4" />
            </>
          )}
        </TabsContent>

        <TabsContent value="enviadas" className="pt-6 outline-none">
          {lists.outgoing.items.length === 0 ? (
            <EmptyState icon={UserPlus} title="No tienes solicitudes enviadas pendientes" description="Las solicitudes que envíes esperan aquí hasta que la otra persona responda." className="rounded-card border border-divider bg-paper-raised" />
          ) : (
            <>
              <RowList label="Solicitudes enviadas">
                {lists.outgoing.items.map((friendship) => (
                  <li key={friendship.friendship_id} className="flex items-center justify-between gap-3 p-4" data-testid="outgoing-row">
                    <PersonLine name={friendship.counterpart?.display_name ?? "Persona"} meta="Esperando respuesta" />
                    <Button variant="ghost" size="sm" onClick={() => setRemoveTarget(friendship)}>
                      Cancelar<span className="sr-only"> solicitud a {friendship.counterpart?.display_name}</span>
                    </Button>
                  </li>
                ))}
              </RowList>
              <Pagination variant="cursor" hasMore={Boolean(lists.outgoing.nextCursor)} loading={loadingMore === "outgoing"} onLoadMore={() => loadMore("outgoing")} className="mt-4" />
            </>
          )}
        </TabsContent>

        <TabsContent value="buscar" className="pt-6 outline-none">
          <PeopleSearch onChanged={reloadLists} />
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
        title={removeTarget?.status === "PENDING" ? "¿Cancelar la solicitud?" : "¿Eliminar esta amistad?"}
        description={
          removeTarget?.status === "PENDING"
            ? `${removeTarget.counterpart?.display_name ?? "La persona"} ya no verá tu solicitud. Podrás enviarle otra más adelante.`
            : `Ya no podrán inscribirse entre sí con ${removeTarget?.counterpart?.display_name ?? "esta persona"}. Podrán volver a ser amistades más adelante.`
        }
        confirmLabel={removeTarget?.status === "PENDING" ? "Cancelar solicitud" : "Eliminar amistad"}
        onConfirm={() => (removeTarget ? remove(removeTarget) : Promise.resolve(null))}
        describeFailure={friendshipFailure}
      />
    </>
  );
}

const ACTION_LABEL: Record<FriendshipState, string> = {
  NONE: "Agregar",
  PENDING_OUTGOING: "Solicitud enviada",
  PENDING_INCOMING: "Aceptar",
  FRIENDS: "Amistad",
};

function PeopleSearch({ onChanged }: { onChanged: () => Promise<void> }) {
  const [query, setQuery] = React.useState("");
  // Results are keyed by the query that produced them, so a stale response never shows for a newer query.
  const [search, setSearch] = React.useState<{ q: string; results: PersonSearchItem[]; cursor: string | null; failure: ApiFailure | null } | null>(null);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);

  const trimmed = query.replace(/\s+/g, " ").trim();
  const searchable = trimmed.length >= 2;
  const current = searchable && search?.q === trimmed ? search : null;
  const loading = searchable && current === null;
  const results = current && !current.failure ? current.results : null;
  const failure = current?.failure ?? null;
  const cursor = current?.cursor ?? null;
  const announcement = !current ? "" : failure ? "La búsqueda falló." : results!.length === 0 ? "Sin resultados." : `${results!.length}${cursor ? " o más" : ""} resultados.`;

  React.useEffect(() => {
    if (!searchable) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const result = await apiFetch<PersonSearchItem[], { next_cursor?: string | null }>(`/api/v1/people?${new URLSearchParams({ q: trimmed })}`, {
          signal: controller.signal,
        });
        setSearch(
          result.ok
            ? { q: trimmed, results: result.data, cursor: result.meta.next_cursor ?? null, failure: null }
            : { q: trimmed, results: [], cursor: null, failure: result },
        );
      } catch {
        // Aborted by a newer keystroke.
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed, searchable]);

  async function loadMore() {
    if (!current || !cursor || loadingMore) return;
    setLoadingMore(true);
    const result = await apiFetch<PersonSearchItem[], { next_cursor?: string | null }>(`/api/v1/people?${new URLSearchParams({ q: current.q, cursor })}`);
    setLoadingMore(false);
    setSearch((previous) =>
      !previous || previous.q !== current.q
        ? previous
        : result.ok
          ? { ...previous, results: [...previous.results, ...result.data], cursor: result.meta.next_cursor ?? null }
          : { ...previous, failure: result },
    );
  }

  function updateState(id: string, state: FriendshipState, friendshipId: string | null) {
    setSearch((previous) =>
      previous
        ? { ...previous, results: previous.results.map((item) => (item.public_profile_id === id ? { ...item, friendship: { state, friendship_id: friendshipId } } : item)) }
        : previous,
    );
  }

  async function act(item: PersonSearchItem) {
    if (busy) return;
    setBusy(item.public_profile_id);
    if (item.friendship.state === "NONE") {
      const result = await apiFetch<FriendshipView>("/api/v1/friendships", {
        method: "POST",
        body: { public_profile_id: item.public_profile_id },
        idempotencyKey: newIdempotencyKey(),
      });
      if (result.ok) {
        updateState(item.public_profile_id, result.data.status === "ACCEPTED" ? "FRIENDS" : "PENDING_OUTGOING", result.data.friendship_id);
        toast({ tone: "success", title: `Solicitud enviada a ${item.display_name}` });
      } else toast({ tone: "danger", title: "No se pudo enviar la solicitud.", description: friendshipFailure(result) });
    } else if (item.friendship.state === "PENDING_INCOMING" && item.friendship.friendship_id) {
      const result = await apiFetch(`/api/v1/friendships/${item.friendship.friendship_id}/accept`, { method: "POST" });
      if (result.ok) {
        updateState(item.public_profile_id, "FRIENDS", item.friendship.friendship_id);
        toast({ tone: "success", title: `Ahora eres amistad de ${item.display_name}` });
      } else toast({ tone: "danger", title: "No se pudo aceptar.", description: friendshipFailure(result) });
    }
    setBusy(null);
    await onChanged();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="max-w-xl">
        <label htmlFor="people-search" className="text-label font-semibold text-ink">
          Buscar por nombre
        </label>
        <div className="mt-1.5">
          <SearchInput
            id="people-search"
            value={query}
            loading={loading}
            placeholder="Escribe al menos 2 letras"
            autoComplete="off"
            aria-describedby="people-search-help"
            onChange={(event) => setQuery(event.target.value)}
            onClear={() => setQuery("")}
          />
        </div>
        <p id="people-search-help" className="mt-1.5 text-caption text-ink-60">
          Solo aparecen personas mayores de edad con perfil público. Nunca mostramos datos de contacto.
        </p>
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>

      {failure ? (
        <Alert tone="danger" title="No pudimos buscar.">
          {failure.code === "RATE_LIMITED" ? "Hiciste muchas búsquedas seguidas. Espera unos minutos." : errorMessage(failure)}
        </Alert>
      ) : results === null ? null : results.length === 0 ? (
        <EmptyState icon={SearchX} title="No encontramos a nadie con ese nombre" description="Revisa la ortografía o prueba con otro nombre." className="rounded-card border border-divider bg-paper-raised" />
      ) : (
        <>
          <RowList label="Resultados de búsqueda">
            {results.map((item) => {
              const state = item.friendship.state;
              const km = item.public_stats ? Math.round(item.public_stats.verified_distance_m / 1000) : null;
              return (
                <li key={item.public_profile_id} className="flex items-center justify-between gap-3 p-4" data-testid="search-row">
                  <PersonLine
                    name={item.display_name}
                    meta={km !== null ? `${km} km verificados · ${item.public_stats!.verified_participation_count} carreras` : undefined}
                  />
                  <Button
                    size="sm"
                    variant={state === "NONE" || state === "PENDING_INCOMING" ? "primary" : "secondary"}
                    disabled={state === "PENDING_OUTGOING" || state === "FRIENDS" || (busy !== null && busy !== item.public_profile_id)}
                    loading={busy === item.public_profile_id}
                    onClick={() => act(item)}
                  >
                    {ACTION_LABEL[state]}
                    {state === "NONE" || state === "PENDING_INCOMING" ? <span className="sr-only"> a {item.display_name}</span> : null}
                  </Button>
                </li>
              );
            })}
          </RowList>
          <Pagination variant="cursor" hasMore={Boolean(cursor)} loading={loadingMore} onLoadMore={loadMore} />
        </>
      )}
    </div>
  );
}
