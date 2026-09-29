import { apiGet } from "./api";

interface InboxThread {
  requestId: number;
  itemId: number;
  partnerId: number;
}

export function isOverdueScoreNotification(type: string, message: string, requestId?: number | null): boolean {
  return type === "trust_score_changed" && !!requestId && /\boverdue\b/i.test(message);
}

export function buildNotificationChatPath(
  partnerId: number | string,
  requestId?: number | string | null,
): string | null {
  const partner = Number(partnerId);
  if (!Number.isInteger(partner) || partner <= 0) return null;
  if (requestId == null) return `/chat/${partner}`;
  const request = Number(requestId);
  if (!Number.isInteger(request) || request <= 0) return null;
  return `/chat/${partner}?requestId=${request}`;
}

export function findNotificationChatPath(
  threads: InboxThread[],
  requestId: number,
  itemId?: number | null,
): string | null {
  const thread = threads.find((entry) =>
    Number(entry.requestId) === Number(requestId) &&
    (!itemId || Number(entry.itemId) === Number(itemId))
  );
  if (!thread) return null;
  return buildNotificationChatPath(thread.partnerId, requestId);
}

export async function resolveNotificationChatPath(
  requestId: number,
  itemId?: number | null,
): Promise<string | null> {
  for (const path of ["/api/inbox", "/api/inbox?archived=true"]) {
    const threads = await apiGet<InboxThread[]>(path);
    const chatPath = findNotificationChatPath(threads, requestId, itemId);
    if (chatPath) return chatPath;
  }
  return null;
}