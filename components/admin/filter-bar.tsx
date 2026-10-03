"use client";

import React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { nextQuery, withQuery } from "@/components/admin/filters";

/**
 * URL-state filter bar for admin lists (ui-spec §3.14). Search applies on Enter or clear; selects apply
 * at once. Every change pushes a new query string (back/forward walk the filters) and drops `cursor`. Active filters show as removable
 * chips with "Limpiar filtros". `resultSummary` goes in a polite live region so the new count is
 * announced. Inline at every width (admin users are not on the drawer-first mobile pattern), wrapping
 * on small screens.
 */
export type FilterField =
  | { type: "search"; name: string; label: string; placeholder?: string }
  | { type: "select"; name: string; label: string; options: readonly { value: string; label: string }[] };

const ALL = "__all__";

export function FilterBar({
  fields,
  resultSummary,
  className,
}: {
  fields: readonly FilterField[];
  resultSummary?: string;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = React.useTransition();
  const baseId = React.useId();

  const query = searchParams.toString();
  const apply = (changes: Record<string, string | null>) => {
    // push, not replace: every filter change is a history entry so back/forward walk the filter states.
    startTransition(() => router.push(withQuery(pathname, nextQuery(query, changes)), { scroll: false }));
  };

  const searchField = fields.find((field) => field.type === "search");
  const urlSearch = searchField ? (searchParams.get(searchField.name) ?? "") : "";
  const [draft, setDraft] = React.useState(urlSearch);
  // Re-sync the box when the URL changes from outside (chip removal, back/forward): derive during render.
  const [syncedSearch, setSyncedSearch] = React.useState(urlSearch);
  if (syncedSearch !== urlSearch) {
    setSyncedSearch(urlSearch);
    setDraft(urlSearch);
  }

  const active = fields.flatMap((field) => {
    const value = searchParams.get(field.name)?.trim();
    if (!value) return [];
    if (field.type === "search") return [{ name: field.name, field: field.label, label: value }];
    // A value outside the options is one the server ignores too (typo, hostile link): no chip for it.
    const option = field.options.find((candidate) => candidate.value === value);
    return option ? [{ name: field.name, field: field.label, label: option.label }] : [];
  });

  return (
    <div className={className}>
      <form
        role="search"
        aria-label="Filtros"
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (searchField) apply({ [searchField.name]: draft });
        }}
      >
        {fields.map((field) => {
          const id = `${baseId}-${field.name}`;
          if (field.type === "search") {
            return (
              <div key={field.name} className="flex min-w-56 flex-1 flex-col gap-1.5 sm:max-w-sm">
                <label htmlFor={id} className="text-label font-semibold text-ink">
                  {field.label}
                </label>
                <SearchInput
                  id={id}
                  name={field.name}
                  value={draft}
                  placeholder={field.placeholder}
                  loading={pending}
                  autoComplete="off"
                  onChange={(event) => setDraft(event.target.value)}
                  onClear={() => {
                    setDraft("");
                    apply({ [field.name]: null });
                  }}
                />
              </div>
            );
          }
          const current = searchParams.get(field.name) ?? ALL;
          const known = field.options.some((option) => option.value === current);
          return (
            <div key={field.name} className="flex w-44 flex-col gap-1.5">
              <label htmlFor={id} className="text-label font-semibold text-ink">
                {field.label}
              </label>
              <Select value={known ? current : ALL} onValueChange={(value) => apply({ [field.name]: value === ALL ? null : value })}>
                <SelectTrigger id={id}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Todos</SelectItem>
                  {field.options.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          );
        })}
        {searchField ? (
          <Button type="submit" variant="secondary" loading={pending}>
            Buscar
          </Button>
        ) : null}
      </form>

      {active.length > 0 ? (
        <ul className="mt-3 flex flex-wrap items-center gap-2" aria-label="Filtros activos">
          {active.map((chip) => (
            <li key={chip.name}>
              <button
                type="button"
                onClick={() => apply({ [chip.name]: null })}
                aria-label={`Quitar filtro ${chip.field}: ${chip.label}`}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-control bg-paper-raised px-3 text-caption font-semibold text-ink hover:border-ink-60"
              >
                <span className="text-ink-60">{chip.field}:</span> {chip.label}
                <X className="size-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
          <li>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => apply(Object.fromEntries(fields.map((field) => [field.name, null])))}
            >
              Limpiar filtros
            </Button>
          </li>
        </ul>
      ) : null}

      {resultSummary ? (
        <p className="mt-3 text-caption text-ink-60" role="status" aria-live="polite">
          {resultSummary}
        </p>
      ) : null}
    </div>
  );
}
