import { db } from "@db";
import { messages } from "@db/schema";
import { eq, and, gte, asc } from "drizzle-orm";

export function computeActiveStatus(lastActiveAt: Date | string | null): string | null {
  if (!lastActiveAt) return null;
  const diffMs = Date.now() - new Date(lastActiveAt).getTime();
  const mins = diffMs / 60000;
  const hours = diffMs / 3600000;
  const days = diffMs / 86400000;
  if (mins < 5) return "Active now";
  if (hours < 24) return "Active today";
  if (days < 7) return "Active this week";
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

    if (gaps.length < 2) return null;
    const avgHours = gaps.reduce((a, b) => a + b, 0) / gaps.length / 3600000;
    if (avgHours < 3) return "Responds within a few hours";
    if (avgHours < 24) return "Usually responds within 1 day";
    return null;
  } catch {
    return null;
  }
}
