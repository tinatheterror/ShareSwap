import { describe, expect, it } from "vitest";
import { groupRequests, requestsUrlFilter, type RequestSection } from "./request-lanes";

const req = (id: number, section: RequestSection, over: { ownerId?: number; dueDay?: string | null } = {}) => ({
  id,
  requesterId: 2,
  item: { ownerId: over.ownerId ?? 1 },
  lane: { section, actionLabel: null, statusLine: "", dueDay: over.dueDay ?? null },
});

describe("groupRequests", () => {
  const all = [
    req(1, "in_progress", { dueDay: "2026-11-09" }),
    req(2, "action"),
    req(3, "in_progress", { dueDay: "2026-11-03" }),
    req(4, "history"),
    req(5, "action", { ownerId: 2, dueDay: "2026-11-01" }),
  ];

  it("splits by section and orders dated requests first, soonest due first", () => {
    const g = groupRequests(all, 1, "all");
    expect(g.action.map((r) => r.id)).toEqual([5, 2]);
    expect(g.inProgress.map((r) => r.id)).toEqual([3, 1]);
    expect(g.history.map((r) => r.id)).toEqual([4]);
  });

  it("filters by role", () => {
    expect(groupRequests(all, 1, "incoming").action.map((r) => r.id)).toEqual([2]);
    expect(groupRequests(all, 1, "mine").action.map((r) => r.id)).toEqual([5]);
  });
});

describe("requestsUrlFilter", () => {
  it("reads the filter parameter", () => {
    expect(requestsUrlFilter("?filter=blocking-deletion")).toBe("blocking-deletion");
    expect(requestsUrlFilter("")).toBeNull();
  });
});
