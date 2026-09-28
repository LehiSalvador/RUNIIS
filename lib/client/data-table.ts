/**
 * Pure column-priority logic for DataTable (ui-spec §3.13), extracted for unit testing. Below `lg`,
 * admin tables preserve their most important columns and collapse the rest into an expandable
 * row-detail region rather than defaulting to horizontal scroll (Master §189). Each table instance
 * declares a fixed priority per column (lower number = kept longer); this resolves, for a given
 * `keepCount`, which columns stay in the compact table and which move to the row detail, while
 * preserving the caller's original column order within each group.
 */

export type PriorityColumn = { key: string; priority: number };

export type ColumnSplit<T extends PriorityColumn> = {
  visible: T[];
  collapsed: T[];
};

export function splitColumnsByPriority<T extends PriorityColumn>(
  columns: T[],
  keepCount: number,
): ColumnSplit<T> {
  if (keepCount >= columns.length) {
    return { visible: [...columns], collapsed: [] };
  }
  if (keepCount <= 0) {
    return { visible: [], collapsed: [...columns] };
  }

  const rankedKeys = columns
    .map((column, index) => ({ key: column.key, priority: column.priority, index }))
    .sort((a, b) => a.priority - b.priority || a.index - b.index)
    .slice(0, keepCount)
    .map((entry) => entry.key);

  const visibleKeys = new Set(rankedKeys);

  return {
    visible: columns.filter((column) => visibleKeys.has(column.key)),
    collapsed: columns.filter((column) => !visibleKeys.has(column.key)),
  };
}
