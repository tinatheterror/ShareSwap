import { affectedByBlock, BLOCK_AFFECTED_QUERY_PREFIXES, moderationErrorMessage, REPORT_REASONS, submitReport } from "../../lib/moderation";

const mockPost = jest.fn();
jest.mock("@/lib/api", () => ({
  apiPost: (...args: unknown[]) => mockPost(...args),
  apiDelete: jest.fn(),
  apiGet: jest.fn(),
}));

describe("report reasons", () => {
  it("are exactly the ones the server accepts", () => {
    expect(REPORT_REASONS.map((r) => r.key).sort()).toEqual(["harassment", "hate", "illegal", "other", "scam", "sexual", "spam", "violence"]);
    for (const reason of REPORT_REASONS) {
      expect(reason.label.length).toBeGreaterThan(3);
      expect(reason.hint.length).toBeGreaterThan(3);
    }
  });
});

describe("submitReport", () => {
  beforeEach(() => mockPost.mockReset().mockResolvedValue({ id: 1, status: "open", alreadyReported: false }));

  it("sends the target, the reason and trimmed details", async () => {
    await submitReport({ targetType: "item", targetId: 9, reason: "scam", details: "  looks fake  " });
    expect(mockPost).toHaveBeenCalledWith("/api/reports", { targetType: "item", targetId: 9, reason: "scam", details: "looks fake" });
  });

  it("leaves details out when there are none", async () => {
    await submitReport({ targetType: "user", targetId: 4, reason: "spam", details: "   " });
    expect(mockPost).toHaveBeenCalledWith("/api/reports", { targetType: "user", targetId: 4, reason: "spam" });
  });
});

describe("affectedByBlock", () => {
  it("matches what a block changes and nothing else", () => {
    for (const key of ["/api/items", "/api/items/12", "/api/items?type=rent", "/api/conversations", "/api/inbox", "/api/inbox/archived", "/api/wishlists", "/api/all-wishlists", "/api/blocks", "/api/messages/7"]) {
      expect(affectedByBlock([key])).toBe(true);
    }
    for (const key of ["/api/user", "/api/wallet", "/api/itemsfoo", "/api/notifications"]) {
      expect(affectedByBlock([key])).toBe(false);
    }
    expect(affectedByBlock([])).toBe(false);
    expect(affectedByBlock([42])).toBe(false);
    expect(BLOCK_AFFECTED_QUERY_PREFIXES.length).toBeGreaterThan(5);
  });
});

describe("moderationErrorMessage", () => {
  it("uses the server's own words, and a plain fallback otherwise", () => {
    expect(moderationErrorMessage(new Error("You've sent a lot of reports. Please try again later."))).toBe("You've sent a lot of reports. Please try again later.");
    expect(moderationErrorMessage(new Error(""))).toMatch(/try again/i);
    expect(moderationErrorMessage("nope")).toMatch(/try again/i);
  });
});
