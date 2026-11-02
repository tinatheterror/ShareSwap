import { and, desc, eq, sql } from "drizzle-orm";
import {
  CONTENT_REPORT_REASONS,
  CONTENT_REPORT_TARGET_TYPES,
  contentReports,
  db,
  items,
  messages,
  moderationActions,
  notifications,
  userReviews,
  users,
  wishlists,
} from "@workspace/db";
import { accountIsPubliclyVisible } from "./content-visibility";
import { banUser, removeItem } from "./moderation-service";
import { REPORT_SLA_WARN_HOURS } from "./moderation-config";

// Reports from users and what moderators do about them. The service owns every rule; routes only call it.

export type ReportTargetType = (typeof CONTENT_REPORT_TARGET_TYPES)[number];
export type ReportReason = (typeof CONTENT_REPORT_REASONS)[number];
export const MAX_REPORT_DETAILS_LENGTH = 1000;

export type ServiceResult<T = {}> = ({ ok: true } & T) | { ok: false; status: number; error: string };

const isTargetType = (value: unknown): value is ReportTargetType => (CONTENT_REPORT_TARGET_TYPES as readonly unknown[]).includes(value);
const isReason = (value: unknown): value is ReportReason => (CONTENT_REPORT_REASONS as readonly unknown[]).includes(value);
const positiveInt = (value: unknown) => {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof n === "number" && Number.isSafeInteger(n) && n > 0 ? n : null;
};

type Target = { authorId: number | null; snapshot: Record<string, unknown> };

/**
 * Finds what is being reported, who wrote it, and a copy of it as it is now (it can be edited or deleted before a
 * moderator looks). Null when the reporter has no business reporting it: it does not exist, they cannot see it, or a
 * private message is not theirs.
 */
async function loadTarget(reporterId: number, targetType: ReportTargetType, targetId: number): Promise<Target | null> {
  switch (targetType) {
    case "user": {
      const [row] = await db
        .select({ id: users.id, displayName: users.displayName, bio: users.bio, profilePhoto: users.profilePhoto, accountStatus: users.accountStatus })
        .from(users)
        .where(eq(users.id, targetId))
        .limit(1);
      if (!row || !accountIsPubliclyVisible(row)) return null;
      return { authorId: row.id, snapshot: { displayName: row.displayName, bio: row.bio, profilePhoto: row.profilePhoto } };
    }
    case "item": {
      const [row] = await db
        .select({ ownerId: items.ownerId, name: items.name, description: items.description, photos: items.photos, moderationStatus: items.moderationStatus, ownerStatus: users.accountStatus })
        .from(items)
        .leftJoin(users, eq(users.id, items.ownerId))
        .where(eq(items.id, targetId))
        .limit(1);
      if (!row || row.moderationStatus !== "visible" || !accountIsPubliclyVisible({ accountStatus: row.ownerStatus })) return null;
      return { authorId: row.ownerId, snapshot: { name: row.name, description: row.description, photos: row.photos } };
    }
    case "message": {
      // Only a person in the conversation can report a message: a private chat is not open to everyone.
      const [row] = await db
        .select({ senderId: messages.senderId, receiverId: messages.receiverId, content: messages.content, messageType: messages.messageType, requestId: messages.requestId, createdAt: messages.createdAt })
        .from(messages)
        .where(eq(messages.id, targetId))
        .limit(1);
      if (!row || (row.senderId !== reporterId && row.receiverId !== reporterId)) return null;
      return { authorId: row.senderId, snapshot: { content: row.content, messageType: row.messageType, requestId: row.requestId, sentAt: row.createdAt } };
    }
    case "review": {
      const [row] = await db
        .select({ reviewerId: userReviews.reviewerId, rating: userReviews.rating, comment: userReviews.comment, feedbackTags: userReviews.feedbackTags, hiddenAt: userReviews.hiddenAt })
        .from(userReviews)
        .where(eq(userReviews.id, targetId))
        .limit(1);
      if (!row || row.hiddenAt) return null;
      return { authorId: row.reviewerId, snapshot: { rating: row.rating, comment: row.comment, feedbackTags: row.feedbackTags } };
    }
    case "wishlist": {
      const [row] = await db
        .select({ userId: wishlists.userId, itemName: wishlists.itemName, description: wishlists.description, hiddenAt: wishlists.hiddenAt, ownerStatus: users.accountStatus })
        .from(wishlists)
        .leftJoin(users, eq(users.id, wishlists.userId))
        .where(eq(wishlists.id, targetId))
        .limit(1);
      if (!row || row.hiddenAt || !accountIsPubliclyVisible({ accountStatus: row.ownerStatus })) return null;
      return { authorId: row.userId, snapshot: { itemName: row.itemName, description: row.description } };
    }
  }
}

export type CreatedReport = { id: number; status: string; alreadyReported: boolean };

/** Files a report. Reporting the same thing twice while the first is open returns the first. */
export async function createReport(args: {
  reporterId: number;
  targetType: unknown;
  targetId: unknown;
  reason: unknown;
  details?: unknown;
  /** Called once for a new report, after it is stored. Failures are ignored. */
  onCreated?: (report: { id: number; targetType: string; reason: string; details: string | null }) => void | Promise<void>;
}): Promise<ServiceResult<{ report: CreatedReport }>> {
  if (!isTargetType(args.targetType)) return { ok: false, status: 400, error: `targetType must be one of: ${CONTENT_REPORT_TARGET_TYPES.join(", ")}` };
  const targetId = positiveInt(args.targetId);
  if (!targetId) return { ok: false, status: 400, error: "targetId must be an id" };
  if (!isReason(args.reason)) return { ok: false, status: 400, error: `reason must be one of: ${CONTENT_REPORT_REASONS.join(", ")}` };
  let details: string | null = null;
  if (args.details !== undefined && args.details !== null) {
    if (typeof args.details !== "string") return { ok: false, status: 400, error: "details must be text" };
    details = args.details.trim() || null;
    if (details && details.length > MAX_REPORT_DETAILS_LENGTH) {
      return { ok: false, status: 400, error: `details can be at most ${MAX_REPORT_DETAILS_LENGTH} characters` };
    }
  }

  const target = await loadTarget(args.reporterId, args.targetType, targetId);
  if (!target) return { ok: false, status: 404, error: "We couldn't find that to report" };
  if (target.authorId === args.reporterId) return { ok: false, status: 400, error: "You can't report your own content" };

  const inserted = await db
    .insert(contentReports)
    .values({
      reporterId: args.reporterId,
      targetType: args.targetType,
      targetId,
      targetUserId: target.authorId,
      reason: args.reason,
      details,
      snapshot: target.snapshot,
    })
    .onConflictDoNothing()
    .returning({ id: contentReports.id, status: contentReports.status });

  if (inserted.length === 0) {
    const [existing] = await db
      .select({ id: contentReports.id, status: contentReports.status })
      .from(contentReports)
      .where(and(eq(contentReports.reporterId, args.reporterId), eq(contentReports.targetType, args.targetType), eq(contentReports.targetId, targetId), eq(contentReports.status, "open")))
      .limit(1);
    if (existing) return { ok: true, report: { ...existing, alreadyReported: true } };
    return { ok: false, status: 409, error: "Please try again" };
  }

  const report = inserted[0];
  try {
    await args.onCreated?.({ id: report.id, targetType: args.targetType, reason: args.reason, details });
  } catch (err) {
    console.error("[reports] could not announce report", report.id, err);
  }
  return { ok: true, report: { ...report, alreadyReported: false } };
}

// ── The queue ────────────────────────────────────────────────────────────────

export const REPORT_STATUSES = ["open", "actioned", "dismissed"] as const;
const PAGE_SIZE = 30;

export async function listReports(args: { status?: unknown; page?: unknown }) {
  const status = (REPORT_STATUSES as readonly unknown[]).includes(args.status) ? (args.status as string) : "open";
  const page = Math.max(1, positiveInt(args.page) ?? 1);
  const where = eq(contentReports.status, status);

  const [rows, [{ total }], [oldest]] = await Promise.all([
    db
      .select({
        id: contentReports.id,
        status: contentReports.status,
        targetType: contentReports.targetType,
        targetId: contentReports.targetId,
        reason: contentReports.reason,
        details: contentReports.details,
        snapshot: contentReports.snapshot,
        createdAt: contentReports.createdAt,
        resolvedAt: contentReports.resolvedAt,
        resolutionNote: contentReports.resolutionNote,
        reporterId: contentReports.reporterId,
        authorId: contentReports.targetUserId,
        authorUsername: sql<string | null>`(SELECT u.username FROM users u WHERE u.id = ${contentReports.targetUserId})`,
        authorDisplayName: sql<string | null>`(SELECT u.display_name FROM users u WHERE u.id = ${contentReports.targetUserId})`,
        authorStatus: sql<string | null>`(SELECT u.account_status FROM users u WHERE u.id = ${contentReports.targetUserId})`,
        reporterUsername: sql<string | null>`(SELECT u.username FROM users u WHERE u.id = ${contentReports.reporterId})`,
        reporterDisplayName: sql<string | null>`(SELECT u.display_name FROM users u WHERE u.id = ${contentReports.reporterId})`,
        // Qualified by hand: drizzle leaves a single-table column unqualified, which the inner alias would capture.
        otherReportsAgainstAuthor: sql<number>`(SELECT count(*)::int FROM content_reports o WHERE o.target_user_id = content_reports.target_user_id AND o.id <> content_reports.id)`,
      })
      .from(contentReports)
      .where(where)
      // Oldest first while open, so nothing waits behind newer reports; newest first once it is history.
      .orderBy(status === "open" ? contentReports.createdAt : desc(contentReports.createdAt))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db.select({ total: sql<number>`count(*)::int` }).from(contentReports).where(where),
    db.select({ createdAt: sql<Date | null>`min(${contentReports.createdAt})` }).from(contentReports).where(eq(contentReports.status, "open")),
  ]);

  const now = Date.now();
  const hoursSince = (at: Date | null) => (at ? Math.floor((now - new Date(at).getTime()) / 3_600_000) : null);
  return {
    reports: rows.map((r) => {
      const ageHours = hoursSince(r.createdAt) ?? 0;
      return {
        id: r.id,
        status: r.status,
        targetType: r.targetType,
        targetId: r.targetId,
        reason: r.reason,
        details: r.details,
        snapshot: r.snapshot,
        createdAt: r.createdAt,
        ageHours,
        overdue: r.status === "open" && ageHours >= REPORT_SLA_WARN_HOURS,
        resolvedAt: r.resolvedAt,
        resolutionNote: r.resolutionNote,
        reporter: r.reporterId ? { id: r.reporterId, username: r.reporterUsername, displayName: r.reporterDisplayName } : null,
        author: r.authorId ? { id: r.authorId, username: r.authorUsername, displayName: r.authorDisplayName, accountStatus: r.authorStatus } : null,
        otherReportsAgainstAuthor: r.otherReportsAgainstAuthor,
      };
    }),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    oldestOpenAgeHours: hoursSince(oldest?.createdAt ?? null),
  };
}

/** For the admin stats: how many reports wait, and how long the oldest has waited. */
export async function reportQueueStats() {
  const [row] = await db
    .select({ open: sql<number>`count(*)::int`, oldest: sql<Date | null>`min(${contentReports.createdAt})` })
    .from(contentReports)
    .where(eq(contentReports.status, "open"));
  const oldestOpenReportAgeHours = row?.oldest ? Math.floor((Date.now() - new Date(row.oldest).getTime()) / 3_600_000) : null;
  return { openReports: row?.open ?? 0, oldestOpenReportAgeHours };
}

// ── Resolving ────────────────────────────────────────────────────────────────

export const RESOLVE_ACTIONS = ["dismiss", "remove_content", "warn_user", "ban_user"] as const;
export type ResolveAction = (typeof RESOLVE_ACTIONS)[number];

const WHAT: Record<ReportTargetType, string> = {
  user: "profile",
  item: "listing",
  message: "message",
  review: "review",
  wishlist: "wishlist post",
};

export async function resolveReport(args: {
  adminId: number;
  reportId: number;
  action: unknown;
  note?: unknown;
}): Promise<ServiceResult<{ resolvedReportIds: number[] }>> {
  if (!(RESOLVE_ACTIONS as readonly unknown[]).includes(args.action)) {
    return { ok: false, status: 400, error: `action must be one of: ${RESOLVE_ACTIONS.join(", ")}` };
  }
  const action = args.action as ResolveAction;
  const note = typeof args.note === "string" && args.note.trim() ? args.note.trim().slice(0, 1000) : null;

  const [report] = await db.select().from(contentReports).where(eq(contentReports.id, args.reportId)).limit(1);
  if (!report) return { ok: false, status: 404, error: "Report not found" };
  if (report.status !== "open") return { ok: false, status: 409, error: "This report was already handled" };
  const targetType = report.targetType as ReportTargetType;

  // 1. Do the thing. Each is idempotent, so a failure after it leaves the report open and the click can be repeated.
  let auditAction: string | null = null;
  let noticeToAuthor: { title: string; message: string; itemId?: number } | null = null;
  if (action === "remove_content") {
    if (targetType === "user") return { ok: false, status: 400, error: "A profile can't be removed: warn or ban the person instead" };
    if (targetType === "item") {
      const removed = await removeItem({ adminId: args.adminId, itemId: report.targetId, note, reportId: report.id });
      if (!removed.ok) return removed;
      noticeToAuthor = { title: "Your listing was removed", message: "A moderator removed your listing because it broke our Community Guidelines.", itemId: report.targetId };
    } else {
      const now = new Date();
      if (targetType === "review") await db.update(userReviews).set({ hiddenAt: now }).where(eq(userReviews.id, report.targetId));
      else if (targetType === "message") await db.update(messages).set({ hiddenAt: now }).where(eq(messages.id, report.targetId));
      else await db.update(wishlists).set({ hiddenAt: now }).where(eq(wishlists.id, report.targetId));
      auditAction = targetType === "review" ? "hide_review" : targetType === "message" ? "hide_message" : "hide_wishlist";
      noticeToAuthor = { title: `Your ${WHAT[targetType]} was removed`, message: `A moderator removed your ${WHAT[targetType]} because it broke our Community Guidelines.` };
    }
  } else if (action === "warn_user") {
    if (!report.targetUserId) return { ok: false, status: 400, error: "This report has no author to warn" };
    auditAction = "warn_user";
    noticeToAuthor = { title: "A reminder about our Community Guidelines", message: `A ${WHAT[targetType]} of yours was reported. Please review our Community Guidelines: repeated or serious violations can lead to your account being banned.` };
  } else if (action === "ban_user") {
    if (!report.targetUserId) return { ok: false, status: 400, error: "This report has no author to ban" };
    const banned = await banUser({ adminId: args.adminId, userId: report.targetUserId, reason: note ?? `Banned after report #${report.id}`, reportId: report.id });
    if (!banned.ok) return banned;
  }

  // 2. Record it: close this report and every other open one about the same thing (or, after a ban, the same person),
  // audit, and tell the people involved. One transaction, so the queue and the log agree.
  const status = action === "dismiss" ? "dismissed" : "actioned";
  const resolvedIds = await db.transaction(async (tx) => {
    const sameTarget = and(eq(contentReports.targetType, report.targetType), eq(contentReports.targetId, report.targetId));
    const scope = action === "ban_user" && report.targetUserId
      ? sql`(${contentReports.targetUserId} = ${report.targetUserId} OR (${contentReports.targetType} = ${report.targetType} AND ${contentReports.targetId} = ${report.targetId}))`
      : sameTarget;
    const closed = await tx
      .update(contentReports)
      .set({ status, resolvedBy: args.adminId, resolvedAt: new Date(), resolutionNote: note })
      .where(and(eq(contentReports.status, "open"), scope!))
      .returning({ id: contentReports.id, reporterId: contentReports.reporterId });

    // Removing a listing and banning write their own audit rows (linked to this report); the rest are recorded here.
    const recorded = action === "dismiss" ? "dismiss_report" : auditAction;
    if (recorded) {
      await tx.insert(moderationActions).values({ adminId: args.adminId, action: recorded, targetType: report.targetType, targetId: report.targetId, reportId: report.id, note });
    }

    const reporters = [...new Set(closed.map((c) => c.reporterId).filter((id): id is number => typeof id === "number"))];
    if (reporters.length) {
      await tx.insert(notifications).values(
        reporters.map((userId) => ({
          userId,
          type: "report_resolved",
          title: "We reviewed your report",
          message: action === "dismiss" ? "Thanks for letting us know. We reviewed it and didn't find a violation." : "Thanks for letting us know. We reviewed it and took action.",
        })),
      );
    }
    if (noticeToAuthor && report.targetUserId) {
      await tx.insert(notifications).values({ userId: report.targetUserId, type: action === "warn_user" ? "moderation_warning" : "content_removed", title: noticeToAuthor.title, message: noticeToAuthor.message, itemId: noticeToAuthor.itemId ?? null });
    }
    return closed.map((c) => c.id);
  });

  return { ok: true, resolvedReportIds: resolvedIds };
}
