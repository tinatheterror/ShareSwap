import { describe, expect, it } from "vitest";
import { groupThreads, hiddenUnread, mergeThreads, type RequestLane } from "./inbox-sections";

const lane = (section: RequestLane["section"], dueDay: string | null = null): RequestLane => ({ section, actionLabel: null, statusLine: "", dueDay });
const thread = (requestId: number, l?: RequestLane, over: Partial<{ iAmRequester: boolean; requestType: string; unreadCount: number }> = {}) =>
  ({ requestId, requestType: "BORROW", iAmRequester: false, unreadCount: 0, lane: l, ...over });

describe("groupThreads", () => {
  const threads = [
    thread(1, lane("in_progress", "2026-11-09")),
    thread(2, lane("action"), { iAmRequester: true }),
    thread(3, lane("in_progress", "2026-11-03")),
    thread(4, lane("history")),
    thread(5),
  ];

  it("splits by section, soonest due date first; a thread without a lane counts as in progress", () => {
    const g = groupThreads(threads, "all");
    expect(g.action.map((t) => t.requestId)).toEqual([2]);
    expect(g.inProgress.map((t) => t.requestId)).toEqual([3, 1, 5]);
    expect(g.history.map((t) => t.requestId)).toEqual([4]);
  });

  it("filters by who asked", () => {
    expect(groupThreads(threads, "mine").action.map((t) => t.requestId)).toEqual([2]);
    expect(groupThreads(threads, "incoming").action).toEqual([]);
  });
});

describe("the unread filter", () => {
  it("keeps threads with unread messages or something to do", () => {
    const g = groupThreads([thread(1, lane("in_progress")), thread(2, lane("in_progress"), { unreadCount: 1 }), thread(3, lane("action"))], "unread");
    expect([...g.action, ...g.inProgress].map((t) => t.requestId).sort()).toEqual([2, 3]);
  });
});

describe("mergeThreads", () => {
  it("drops a thread listed in both the active and archived lists", () => {
    expect(mergeThreads([thread(1), thread(2)], [thread(2), thread(3)]).map((t) => t.requestId)).toEqual([1, 2, 3]);
  });
});

describe("hiddenUnread", () => {
  it("counts unread messages in history threads only", () => {
    expect(hiddenUnread([thread(1, lane("history"), { unreadCount: 2 }), thread(2, lane("action"), { unreadCount: 5 })])).toBe(2);
  });
});
