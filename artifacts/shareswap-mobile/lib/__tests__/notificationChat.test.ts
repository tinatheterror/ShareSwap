import {
  buildNotificationChatPath,
  findNotificationChatPath,
  isOverdueScoreNotification,
  resolveNotificationChatPath,
} from "../notificationChat";
import { apiGet } from "../api";

jest.mock("../api", () => ({ apiGet: jest.fn() }));

describe("request notification navigation", () => {
  const threads = [
    { requestId: 41, itemId: 7, partnerId: 9 },
    { requestId: 42, itemId: 8, partnerId: 9 },
  ];

  it("opens the exact item request, not another chat with the same person", () => {
    expect(findNotificationChatPath(threads, 42, 8)).toBe("/chat/9?requestId=42");
    expect(findNotificationChatPath(threads, 42, 7)).toBeNull();
    expect(findNotificationChatPath(threads, 99, 8)).toBeNull();
  });

  it("finds older overdue alerts in archived conversations", async () => {
    (apiGet as jest.Mock).mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ requestId: 42, itemId: 8, partnerId: 9 }]);

    expect(await resolveNotificationChatPath(42, 8)).toBe("/chat/9?requestId=42");
    expect(apiGet).toHaveBeenNthCalledWith(1, "/api/inbox");
    expect(apiGet).toHaveBeenNthCalledWith(2, "/api/inbox?archived=true");
  });

  it("keeps the request on direct push chat links", () => {
    expect(buildNotificationChatPath(9, 42)).toBe("/chat/9?requestId=42");
    expect(buildNotificationChatPath(9)).toBe("/chat/9");
    expect(buildNotificationChatPath("bad", 42)).toBeNull();
    expect(buildNotificationChatPath(9, -1)).toBeNull();
  });

  it("routes serious overdue score penalties to the item chat but other score changes to achievements", () => {
    expect(isOverdueScoreNotification("trust_score_changed", "Item is 15 days overdue. A penalty was applied.", 42)).toBe(true);
    expect(isOverdueScoreNotification("trust_score_changed", "Your score went up by 10 points.", 42)).toBe(false);
    expect(isOverdueScoreNotification("trust_score_changed", "Item is overdue.", null)).toBe(false);
  });
});