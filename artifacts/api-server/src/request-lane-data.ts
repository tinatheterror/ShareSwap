import { and, eq, inArray } from "drizzle-orm";
import { db, extensionRequests, userReviews } from "@workspace/db";

/** Requests where the borrower's extension request is waiting on the owner. */
export async function pendingExtensionRequestIds(requestIds: number[], executor: Pick<typeof db, "select"> = db): Promise<Set<number>> {
  if (requestIds.length === 0) return new Set();
  const rows = await executor
    .select({ requestId: extensionRequests.requestId })
    .from(extensionRequests)
    .where(and(inArray(extensionRequests.requestId, requestIds), eq(extensionRequests.status, "pending")));
  return new Set(rows.map((r) => r.requestId));
}

/** Requests the user has already left a review for. */
export async function reviewedRequestIds(userId: number, requestIds: number[], executor: Pick<typeof db, "select"> = db): Promise<Set<number>> {
  if (requestIds.length === 0) return new Set();
  const rows = await executor
    .select({ transactionId: userReviews.transactionId })
    .from(userReviews)
    .where(and(eq(userReviews.reviewerId, userId), inArray(userReviews.transactionId, requestIds)));
  return new Set(rows.map((r) => r.transactionId).filter((id): id is number => id !== null));
}
