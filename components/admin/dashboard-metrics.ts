/**
 * Dashboard tiles computed from the Editions list (GET /api/v1/admin/events). Pure so it is unit-tested;
 * the dashboard reads one page (up to `DASHBOARD_SAMPLE`) and says so when the list was truncated.
 * Tiles only count what this build can read today; request/attendance counters arrive with their own
 * screens and APIs (P3-G/P3-I/P3-J) and are added to the dashboard then, not faked here.
 */
export const DASHBOARD_SAMPLE = 100;

export type MetricEdition = {
  publication_state: string;
  registration_state: string;
  execution_state: string;
  sport_date: string | null;
};

export type EditionMetrics = {
  upcoming: number;
  registrationOpen: number;
  drafts: number;
  inProgress: number;
};

function isUpcoming(item: MetricEdition, today: string): boolean {
  return (
    item.publication_state === "PUBLISHED" &&
    item.execution_state === "SCHEDULED" &&
    item.sport_date !== null &&
    item.sport_date >= today
  );
}

/** `today` is a YYYY-MM-DD business-zone date. Upcoming = published, scheduled, with a date from today on. */
export function editionMetrics(items: readonly MetricEdition[], today: string): EditionMetrics {
  return {
    upcoming: items.filter((item) => isUpcoming(item, today)).length,
    registrationOpen: items.filter((item) => item.publication_state === "PUBLISHED" && item.registration_state === "OPEN").length,
    drafts: items.filter((item) => item.publication_state === "DRAFT").length,
    inProgress: items.filter((item) => item.execution_state === "IN_PROGRESS").length,
  };
}

/** Next published, scheduled editions by date, soonest first. */
export function upcomingEditions<T extends MetricEdition>(items: readonly T[], today: string, limit = 5): T[] {
  return items
    .filter((item) => isUpcoming(item, today))
    .sort((a, b) => (a.sport_date ?? "").localeCompare(b.sport_date ?? ""))
    .slice(0, limit);
}
