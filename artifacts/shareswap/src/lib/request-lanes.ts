/**
 * How the Requests page groups requests. The server decides each request's section (see request-lanes.ts in
 * the API); this only sorts and filters what it sent.
 */
export type RequestSection = "action" | "in_progress" | "history";

export type RequestLane = {
  section: RequestSection;
  actionLabel: string | null;
  statusLine: string;
  /** YYYY-MM-DD the status line refers to, or null. */
  dueDay: string | null;
};

/** Incoming: someone asked for my item. Mine: I asked for theirs. */
export type RoleFilter = "all" | "incoming" | "mine";

export const ROLE_FILTERS: { key: RoleFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "incoming", label: "Incoming" },
  { key: "mine", label: "Mine" },
];

export const BLOCKING_DELETION_FILTER = "blocking-deletion";

/** The `filter` query parameter of the /requests URL (`?filter=blocking-deletion`). */
export function requestsUrlFilter(search: string): string | null {
  return new URLSearchParams(search).get("filter");
}

type Grouped = { lane: RequestLane; requesterId: number; item: { ownerId: number } };

export function groupRequests<T extends Grouped>(requests: T[], viewerId: number | undefined, role: RoleFilter) {
  const visible = requests.filter((r) => {
    const incoming = r.item.ownerId === viewerId;
    return role === "all" || (role === "incoming" ? incoming : !incoming);
  });
  // Soonest due date first; requests without one keep the server's newest-first order after the dated ones.
  const byDue = (a: T, b: T) => (a.lane.dueDay ?? "9999-12-31").localeCompare(b.lane.dueDay ?? "9999-12-31");
  const inSection = (section: RequestSection) => visible.filter((r) => r.lane.section === section);
  return {
    action: inSection("action").sort(byDue),
    inProgress: inSection("in_progress").sort(byDue),
    history: inSection("history"),
  };
}
