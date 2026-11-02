import { apiDelete, apiGet, apiPost } from "@/lib/api";

// Reporting and blocking, as the server defines them (see content_reports / user_blocks). The reasons are the server's
// list: it refuses anything else.

export type ReportTargetType = "user" | "item" | "message" | "review" | "wishlist";
export type ReportReason = "spam" | "harassment" | "hate" | "sexual" | "violence" | "illegal" | "scam" | "other";

export const REPORT_REASONS: readonly { key: ReportReason; label: string; hint: string }[] = [
  { key: "harassment", label: "Harassment or bullying", hint: "Threats, abuse or unwanted contact" },
  { key: "hate", label: "Hate speech", hint: "Attacks people for who they are" },
  { key: "sexual", label: "Sexual content", hint: "Explicit or inappropriate" },
  { key: "violence", label: "Violence", hint: "Graphic or threatening" },
  { key: "scam", label: "Scam or fraud", hint: "Fake listing, payment outside the app" },
  { key: "illegal", label: "Illegal or prohibited item", hint: "Weapons, drugs, stolen goods" },
  { key: "spam", label: "Spam or advertising", hint: "Unrelated promotion" },
  { key: "other", label: "Something else", hint: "Tell us in the note" },
];

export const MAX_REPORT_DETAILS = 1000;

export type ReportInput = { targetType: ReportTargetType; targetId: number; reason: ReportReason; details?: string };

export function submitReport(input: ReportInput) {
  const details = input.details?.trim();
  return apiPost<{ id: number; status: string; alreadyReported: boolean }>("/api/reports", {
    targetType: input.targetType,
    targetId: input.targetId,
    reason: input.reason,
    ...(details ? { details } : {}),
  });
}

export const blockUser = (userId: number) => apiPost<{ blocked: true }>(`/api/blocks/${userId}`);
export const unblockUser = (userId: number) => apiDelete<{ blocked: false }>(`/api/blocks/${userId}`);

export type BlockedUser = { userId: number; username: string; displayName: string | null; profilePhoto: string | null; blockedAt: string };
export const fetchBlockedUsers = () => apiGet<BlockedUser[]>("/api/blocks");

/**
 * What a block or an unblock changes on screen: listings, wishlist posts, conversations and the inbox are all filtered by
 * the server per viewer, so each of these has to be fetched again.
 */
export const BLOCK_AFFECTED_QUERY_PREFIXES = ["/api/items", "/api/conversations", "/api/inbox", "/api/wishlists", "/api/all-wishlists", "/api/blocks", "/api/messages"] as const;

export function affectedByBlock(queryKey: readonly unknown[]): boolean {
  const first = queryKey[0];
  return typeof first === "string" && BLOCK_AFFECTED_QUERY_PREFIXES.some((prefix) => first === prefix || first.startsWith(`${prefix}/`) || first.startsWith(`${prefix}?`));
}

/** The words for a refusal, from what the server said (its message is already written for people). */
export function moderationErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return message || "Something went wrong. Please try again.";
}
