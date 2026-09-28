"use client";

import React from "react";
import { ChevronDown, ChevronUp, ChevronsUpDown, Download, SearchX } from "lucide-react";
import { cn } from "@/lib/client/cn";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { EmptyState, type EmptyStateProps } from "@/components/ui/empty-state";
import { SkeletonRow } from "@/components/ui/skeleton";
import { splitColumnsByPriority, type PriorityColumn } from "@/lib/client/data-table";

/**
 * ui-spec §3.13 DataTable. All columns show at lg+, where the table scrolls inside a max-height
 * region so the sticky header stays visible. Below lg only the `keepColumnsBelowLg` highest-priority
 * columns stay in the row (below md, `keepColumnsBelowMd`); the others move into a row detail opened
 * by the row's disclosure button instead of horizontal scroll (Master §189). Row actions also move
 * into the detail below md. Loading = skeleton rows; empty = inline EmptyState. Bulk selection uses
 * an indeterminate header checkbox; callers confirm bulk actions in a Modal naming the count. CSV
 * export renders only when `canExportCsv` (mirror of the server permission).
 */
export type DataTableColumn<T> = PriorityColumn & {
  header: string;
  align?: "left" | "right";
  sortable?: boolean;
  render: (row: T) => React.ReactNode;
};

export type DataTableProps<T> = {
  columns: DataTableColumn<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  /** Human label of a row for its checkbox/disclosure names, e.g. the participant name. */
  getRowLabel?: (row: T) => string;
  /** Accessible table name (visually hidden caption). */
  caption: string;
  keepColumnsBelowLg?: number;
  keepColumnsBelowMd?: number;
  loading?: boolean;
  loadingRowCount?: number;
  emptyState?: EmptyStateProps;
  sortKey?: string;
  sortDirection?: "asc" | "desc";
  onSortChange?: (key: string) => void;
  selectable?: boolean;
  selectedIds?: ReadonlySet<string>;
  onSelectedIdsChange?: (ids: Set<string>) => void;
  rowActions?: (row: T) => React.ReactNode;
  canExportCsv?: boolean;
  onExportCsv?: () => void;
  className?: string;
};

type Visibility = "always" | "md" | "lg";

const CELL_VISIBILITY: Record<Visibility, string> = {
  always: "",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
};

export function DataTable<T>({
  columns,
  rows,
  getRowId,
  getRowLabel,
  caption,
  keepColumnsBelowLg = 3,
  keepColumnsBelowMd = keepColumnsBelowLg,
  loading = false,
  loadingRowCount = 5,
  emptyState,
  sortKey,
  sortDirection,
  onSortChange,
  selectable = false,
  selectedIds,
  onSelectedIdsChange,
  rowActions,
  canExportCsv = false,
  onExportCsv,
  className,
}: DataTableProps<T>) {
  const tableId = React.useId();
  const [expandedIds, setExpandedIds] = React.useState<Set<string>>(new Set());

  const visibility = React.useMemo(() => {
    const belowLg = new Set(splitColumnsByPriority(columns, keepColumnsBelowLg).collapsed.map((c) => c.key));
    const belowMd = new Set(
      splitColumnsByPriority(columns, Math.min(keepColumnsBelowMd, keepColumnsBelowLg)).collapsed.map((c) => c.key),
    );
    return new Map<string, Visibility>(
      columns.map((c) => [c.key, belowLg.has(c.key) ? "lg" : belowMd.has(c.key) ? "md" : "always"]),
    );
  }, [columns, keepColumnsBelowLg, keepColumnsBelowMd]);

  const detailColumns = columns.filter((c) => visibility.get(c.key) !== "always");
  const hasLgDetail = detailColumns.some((c) => visibility.get(c.key) === "lg");
  // The disclosure exists wherever something is missing from the compact row.
  const detailHiddenAt = hasLgDetail ? "lg:hidden" : detailColumns.length > 0 || rowActions ? "md:hidden" : null;
  const totalColumnCount = columns.length + (selectable ? 1 : 0) + (detailHiddenAt ? 1 : 0) + (rowActions ? 1 : 0);

  const selected = selectedIds ?? new Set<string>();
  const allSelected = rows.length > 0 && rows.every((row) => selected.has(getRowId(row)));
  const someSelected = !allSelected && rows.some((row) => selected.has(getRowId(row)));

  function toggleRow(id: string, checked: boolean) {
    if (!onSelectedIdsChange) return;
    const next = new Set(selected);
    if (checked) next.add(id);
    else next.delete(id);
    onSelectedIdsChange(next);
  }

  function toggleExpanded(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className={cn("overflow-hidden rounded-card border border-divider bg-paper-raised", className)}>
      {canExportCsv ? (
        <div className="flex justify-end border-b border-divider p-2">
          <Button variant="ghost" size="sm" onClick={onExportCsv}>
            <Download className="size-4" aria-hidden="true" />
            Exportar CSV
          </Button>
        </div>
      ) : null}

      <div className="overflow-x-auto lg:max-h-[70vh] lg:overflow-y-auto">
        <table className="w-full border-collapse text-body-sm" aria-busy={loading || undefined}>
          <caption className="sr-only">{caption}</caption>
          <thead className="sticky top-0 z-sticky-header bg-paper-raised">
            <tr className="border-b border-divider">
              {selectable ? (
                <th scope="col" className="w-11 px-1">
                  <Checkbox
                    id={`${tableId}-all`}
                    checked={someSelected ? "indeterminate" : allSelected}
                    disabled={rows.length === 0}
                    onCheckedChange={(checked) =>
                      onSelectedIdsChange?.(checked === true ? new Set(rows.map(getRowId)) : new Set())
                    }
                    aria-label="Seleccionar todas las filas"
                  />
                </th>
              ) : null}
              {detailHiddenAt ? (
                <th scope="col" className={cn("w-11", detailHiddenAt)}>
                  <span className="sr-only">Detalle</span>
                </th>
              ) : null}
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={
                    column.sortable && sortKey === column.key
                      ? sortDirection === "desc"
                        ? "descending"
                        : "ascending"
                      : undefined
                  }
                  className={cn(
                    "px-3 py-1 text-left text-label font-semibold whitespace-nowrap text-ink-60 lg:px-4",
                    column.align === "right" && "text-right",
                    CELL_VISIBILITY[visibility.get(column.key) ?? "always"],
                  )}
                >
                  {column.sortable && onSortChange ? (
                    <button
                      type="button"
                      onClick={() => onSortChange(column.key)}
                      className="-mx-2 inline-flex min-h-11 items-center gap-1 rounded-control px-2 hover:text-ink"
                    >
                      {column.header}
                      {sortKey === column.key ? (
                        sortDirection === "desc" ? (
                          <ChevronDown className="size-3.5" aria-hidden="true" />
                        ) : (
                          <ChevronUp className="size-3.5" aria-hidden="true" />
                        )
                      ) : (
                        <ChevronsUpDown className="size-3.5 opacity-60" aria-hidden="true" />
                      )}
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              ))}
              {rowActions ? (
                <th scope="col" className="hidden px-3 py-2.5 md:table-cell lg:px-4">
                  <span className="sr-only">Acciones</span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: loadingRowCount }, (_, i) => (
                <tr key={i} className="border-b border-divider last:border-b-0">
                  <td colSpan={totalColumnCount} className="px-4">
                    <SkeletonRow columns={Math.min(columns.length, 6)} />
                  </td>
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={totalColumnCount}>
                  <EmptyState {...(emptyState ?? { icon: SearchX, title: "No hay registros que mostrar" })} />
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const id = getRowId(row);
                const rowLabel = getRowLabel?.(row);
                const expanded = expandedIds.has(id);

                return (
                  <React.Fragment key={id}>
                    <tr
                      className={cn(
                        "border-b border-divider transition-colors duration-fast hover:bg-paper-sunken/60",
                        selected.has(id) && "bg-lime-soft/50",
                      )}
                    >
                      {selectable ? (
                        <td className="px-1">
                          <Checkbox
                            id={`${tableId}-row-${id}`}
                            checked={selected.has(id)}
                            onCheckedChange={(checked) => toggleRow(id, checked === true)}
                            aria-label={`Seleccionar ${rowLabel ?? "fila"}`}
                          />
                        </td>
                      ) : null}
                      {detailHiddenAt ? (
                        <td className={detailHiddenAt}>
                          <IconButton
                            aria-label={`${expanded ? "Ocultar" : "Ver"} detalle${rowLabel ? ` de ${rowLabel}` : ""}`}
                            aria-expanded={expanded}
                            aria-controls={`${tableId}-detail-${id}`}
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleExpanded(id)}
                          >
                            {expanded ? (
                              <ChevronUp className="size-4" aria-hidden="true" />
                            ) : (
                              <ChevronDown className="size-4" aria-hidden="true" />
                            )}
                          </IconButton>
                        </td>
                      ) : null}
                      {columns.map((column) => (
                        <td
                          key={column.key}
                          className={cn(
                            "px-3 py-2.5 text-ink lg:px-4",
                            column.align === "right" && "text-right tabular-nums",
                            CELL_VISIBILITY[visibility.get(column.key) ?? "always"],
                          )}
                        >
                          {column.render(row)}
                        </td>
                      ))}
                      {rowActions ? (
                        <td className="hidden px-3 py-2.5 text-right md:table-cell lg:px-4">{rowActions(row)}</td>
                      ) : null}
                    </tr>
                    {detailHiddenAt && expanded ? (
                      <tr id={`${tableId}-detail-${id}`} className={cn("border-b border-divider bg-paper-sunken", detailHiddenAt)}>
                        <td colSpan={totalColumnCount} className="px-4 py-3">
                          {detailColumns.length > 0 ? (
                            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
                              {detailColumns.map((column) => (
                                <div
                                  key={column.key}
                                  className={cn("min-w-0", visibility.get(column.key) === "md" && "md:hidden")}
                                >
                                  <dt className="text-caption text-ink-60">{column.header}</dt>
                                  <dd className="text-body-sm text-ink">{column.render(row)}</dd>
                                </div>
                              ))}
                            </dl>
                          ) : null}
                          {rowActions ? (
                            <div className={cn("flex flex-wrap gap-2 md:hidden", detailColumns.length > 0 && "mt-3")}>
                              {rowActions(row)}
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    ) : null}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
