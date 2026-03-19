import { db } from "@db";
import { messages } from "@db/schema";
import { eq, and, gte, asc, desc } from "drizzle-orm";

function statusFromTimestamp(ts: Date | string): string | null {
  const diffMs = Date.now() - new Date(ts).getTime();
  const mins = diffMs / 60000;
  const hours = diffMs / 3600000;
  const days = diffMs / 86400000;
  if (mins < 5) return "Active now";
  if (hours < 24) return "Active today";
  if (days < 7) return "Active this week";
  if (days < 30) return "Active this month";
  return null;
}

/** Fast sync version — only works when lastActiveAt is fresh (own profile via /api/user). */
export function computeActiveStatus(lastActiveAt: Date | string | null): string | null {
  if (!lastActiveAt) return null;
  return statusFromTimestamp(lastActiveAt);
}

/**
 * Async version for public profiles — falls back to last sent-message timestamp
 * when lastActiveAt is null (e.g. support/test accounts).
 */
export async function computeActiveStatusFromDb(
  userId: number,
  lastActiveAt: Date | string | null
): Promise<string | null> {
  if (lastActiveAt) {
    const s = statusFromTimestamp(lastActiveAt);
    if (s) return s;
  }
  try {
    const [lastMsg] = await db
      .select({ createdAt: messages.createdAt })
      .from(messages)
      .where(eq(messages.senderId, userId))
      .orderBy(desc(messages.createdAt))
      .limit(1);
    if (lastMsg?.createdAt) return statusFromTimestamp(lastMsg.createdAt);
  } catch {
    // ignore
  }
  return null;
}

export async function computeResponseTime(userId: number): Promise<string | null> {
  try {
    const since = new Date(Date.now() - 28 * 24 * 3600 * 1000);

    const received = await db
      .select({ id: messages.id, senderId: messages.senderId, createdAt: messages.createdAt })
      .from(messages)
      .where(and(eq(messages.receiverId, userId), gte(messages.createdAt, since)))
      .orderBy(asc(messages.createdAt));

    const sent = await db
      .select({ id: messages.id, receiverId: messages.receiverId, createdAt: messages.createdAt })
      .from(messages)
      .where(and(eq(messages.senderId, userId), gte(messages.createdAt, since)))
      .orderBy(asc(messages.createdAt));

    const gaps: number[] = [];
    for (const msg of received) {
      if (!msg.createdAt) continue;
      const reply = sent.find(
        (s) =>
          s.receiverId === msg.senderId &&
          s.createdAt &&
          s.createdAt > msg.createdAt!
      );
      if (!reply?.createdAt) continue;
      const diffMs = reply.createdAt.getTime() - msg.createdAt.getTime();
      if (diffMs < 7 * 86400000) gaps.push(diffMs);
    }

    if (gaps.length < 1) return null;
    const avgHours = gaps.reduce((a, b) => a + b, 0) / gaps.length / 3600000;
    if (avgHours < 3) return "Responds within a few hours";
    if (avgHours < 24) return "Usually responds within 1 day";
    return null;
  } catch {
    return null;
  }
}
