/**
 * How the Inbox groups request threads. The API decides each thread's section for the signed-in person
 * (`lane`); this only merges, filters and sorts what it sent.
 */
export type RequestSection = "action" | "in_progress" | "history";

export type RequestLane = {
  section: RequestSection;
  actionLabel: string | null;
  statusLine: string;
  /** YYYY-MM-DD the status line refers to, or null. */
  dueDay: string | null;
};

type Thread = { requestId: number; requestType: string; iAmRequester: boolean; unreadCount: number; lane?: RequestLane };

export type InboxFilter = "all" | "incoming" | "mine" | "lending" | "renting" | "swapping" | "gifting" | "history";

/** A thread from an API that predates lanes counts as in progress. */
export const sectionOf = (t: Thread): RequestSection => t.lane?.section ?? "in_progress";

function matchesFilter(t: Thread, filter: InboxFilter): boolean {
  switch (filter) {
    case "incoming": return !t.iAmRequester;
    case "mine": return t.iAmRequester;
    case "lending": return t.requestType === "BORROW";
    case "renting": return t.requestType === "RENT";
    case "swapping": return t.requestType === "SWAP";
    case "gifting": return t.requestType === "GIFT";
    default: return true;
  }
}

/** Active and archived lists can overlap; the first copy wins. */
export function mergeThreads<T extends Thread>(...lists: T[][]): T[] {
  const seen = new Set<number>();
  return lists.flat().filter((t) => (seen.has(t.requestId) ? false : (seen.add(t.requestId), true)));
}

export function groupThreads<T extends Thread>(threads: T[], filter: InboxFilter) {
  const visible = threads.filter((t) => matchesFilter(t, filter));
  // Soonest due date first, then the server's most-recent-activity order.
  const byDue = (a: T, b: T) => (a.lane?.dueDay ?? "9999-12-31").localeCompare(b.lane?.dueDay ?? "9999-12-31");
  const inSection = (s: RequestSection) => visible.filter((t) => sectionOf(t) === s);
  return { action: inSection("action").sort(byDue), inProgress: inSection("in_progress").sort(byDue), history: inSection("history") };
}

/** Unread messages in threads the default view hides, shown on the History filter. */
export const hiddenUnread = (threads: Thread[]): number =>
  threads.filter((t) => sectionOf(t) === "history").reduce((n, t) => n + t.unreadCount, 0);
