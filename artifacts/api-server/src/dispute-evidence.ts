import { allUploadedBy } from "./dispute-evidence-files";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  db, disputeEvidence, itemConditionVerifications, itemRequests, items, messages, platformDisputes, requestLifecycleEvents, users,
} from "@workspace/db";

/**
 * Evidence for a Stripe dispute. The owner is asked in the app (platform-disputes.ts sends the request) and answers here with a note
 * and photos; an admin then pulls one bundle that also contains what the platform already knows (the handoff and return
 * confirmations, the timeline, the messages about the rental, the item's photos) and submits it to Stripe by hand. Nothing here is
 * sent to Stripe automatically.
 */
export const EVIDENCE_NOTE_MAX = 4000;
export const EVIDENCE_PHOTOS_MAX = 10;

export type EvidenceSubmitResult =
  | { status: "saved"; id: number }
  | { status: "invalid"; error: string }
  | { status: "not_found" | "forbidden" };

/** The owner of the disputed payment's item sends evidence. Anyone else, or an unknown dispute, gets nothing (and learns nothing). */
export async function submitOwnerEvidence(input: { disputeId: string; userId: number; note?: unknown; photoUrls?: unknown }): Promise<EvidenceSubmitResult> {
  const [dispute] = await db.select({ id: platformDisputes.id, ownerId: platformDisputes.ownerId }).from(platformDisputes).where(eq(platformDisputes.disputeId, input.disputeId)).limit(1);
  if (!dispute || dispute.ownerId !== input.userId) return { status: "not_found" };
  const note = typeof input.note === "string" ? input.note.trim() : "";
  if (input.note != null && typeof input.note !== "string") return { status: "invalid", error: "note must be text." };
  if (note.length > EVIDENCE_NOTE_MAX) return { status: "invalid", error: `The note is too long (${EVIDENCE_NOTE_MAX} characters at most).` };
  const photos = input.photoUrls == null ? [] : input.photoUrls;
  if (!Array.isArray(photos) || photos.length > EVIDENCE_PHOTOS_MAX || !photos.every((p) => typeof p === "string")) {
    return { status: "invalid", error: `photoUrls must be at most ${EVIDENCE_PHOTOS_MAX} photos uploaded for dispute evidence.` };
  }
  // Only photos this member uploaded for dispute evidence: no other path, no outside link, and nobody else's upload.
  if (!(await allUploadedBy(photos as string[], input.userId))) {
    return { status: "invalid", error: "Every photo must be one you uploaded for this evidence." };
  }
  if (!note && photos.length === 0) return { status: "invalid", error: "Send a note, photos, or both." };
  const [row] = await db.insert(disputeEvidence).values({ disputeId: input.disputeId, userId: input.userId, note: note || null, photoUrls: photos as string[] }).returning({ id: disputeEvidence.id });
  return { status: "saved", id: row.id };
}

/** What the owner is being asked for: their disputes that no evidence has been sent for yet, newest first. */
export async function ownerEvidenceRequests(userId: number) {
  const rows = await db.select({
    disputeId: platformDisputes.disputeId, requestId: platformDisputes.requestId, itemName: items.name, amountCents: platformDisputes.amountCents,
    currency: platformDisputes.currency, dueBy: platformDisputes.evidenceDueBy, requestedAt: platformDisputes.evidenceRequestedAt, outcome: platformDisputes.outcome,
  }).from(platformDisputes)
    .leftJoin(itemRequests, eq(itemRequests.id, platformDisputes.requestId))
    .leftJoin(items, eq(items.id, itemRequests.itemId))
    .where(eq(platformDisputes.ownerId, userId)).orderBy(desc(platformDisputes.createdAt)).limit(100);
  const sent = rows.length
    ? await db.select({ disputeId: disputeEvidence.disputeId }).from(disputeEvidence).where(and(eq(disputeEvidence.userId, userId), inArray(disputeEvidence.disputeId, rows.map((r) => r.disputeId))))
    : [];
  const sentIds = new Set(sent.map((s) => s.disputeId));
  // The amount is deliberately left out: it is the platform's loss and not something for the owner to act on.
  return rows.filter((r) => r.outcome === "open" && !sentIds.has(r.disputeId)).map(({ amountCents: _a, currency: _c, outcome: _o, ...rest }) => rest);
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

async function collectBundle(disputeId: string) {
  const [dispute] = await db.select().from(platformDisputes).where(eq(platformDisputes.disputeId, disputeId)).limit(1);
  if (!dispute) return null;
  const memberIds = [dispute.ownerId, dispute.borrowerId].filter((x): x is number => x != null);
  const people = memberIds.length ? await db.select({ id: users.id, username: users.username }).from(users).where(inArray(users.id, memberIds)) : [];
  const nameOf = (id: number | null) => (id == null ? null : people.find((p) => p.id === id)?.username ?? `user ${id}`);

  let request: Record<string, unknown> | null = null;
  let itemInfo: { id: number; name: string; photos: string[] } | null = null;
  let conversation: Array<{ at: string | null; from: string | null; type: string; hidden: boolean; text: string }> = [];
  let timeline: Array<{ at: string; event: string }> = [];
  let conditionPhotos: string[] = [];
  if (dispute.requestId) {
    const [row] = await db.select({ r: itemRequests, itemId: items.id, itemName: items.name, itemPhotos: items.photos }).from(itemRequests)
      .innerJoin(items, eq(items.id, itemRequests.itemId)).where(eq(itemRequests.id, dispute.requestId)).limit(1);
    if (row) {
      const r = row.r;
      itemInfo = { id: row.itemId, name: row.itemName, photos: row.itemPhotos ?? [] };
      request = {
        id: r.id, type: r.requestType, status: r.status, startDate: iso(r.startDate), endDate: iso(r.endDate), deliveryMethod: r.deliveryMethod,
        acceptedAt: iso(r.acceptedAt),
        handoff: {
          ownerConfirmed: r.ownerConfirmedHandoff, ownerConfirmedAt: iso(r.ownerConfirmedHandoffAt),
          borrowerConfirmed: r.borrowerConfirmedHandoff, borrowerConfirmedAt: iso(r.borrowerConfirmedHandoffAt),
          ownerDenied: r.ownerDeniedHandoff, borrowerDenied: r.borrowerDeniedHandoff,
          confirmedAt: iso(r.handoffConfirmedAt), autoAdvancedAfterTimeout: r.handoffAutoAdvanced, method: r.confirmationMethod, pinUsed: r.pinUsed,
          proofNoteFromOwner: r.handoffProofOwner, proofNoteFromBorrower: r.handoffProofBorrower,
        },
        return: {
          ownerConfirmed: r.ownerConfirmedReturn, ownerConfirmedAt: iso(r.ownerConfirmedReturnAt),
          borrowerConfirmed: r.borrowerConfirmedReturn, borrowerConfirmedAt: iso(r.borrowerConfirmedReturnAt),
          sameCondition: r.returnConditionOk, disputeReason: r.returnDisputeReason, disputePhoto: r.returnDisputePhotoUrl,
        },
      };
      const msgs = await db.select().from(messages).where(eq(messages.requestId, r.id)).orderBy(asc(messages.createdAt), asc(messages.id)).limit(500);
      const senders = [...new Set(msgs.map((m) => m.senderId).filter((x): x is number => x != null))];
      const senderRows = senders.length ? await db.select({ id: users.id, username: users.username }).from(users).where(inArray(users.id, senders)) : [];
      conversation = msgs.map((m) => ({
        at: iso(m.createdAt), from: m.senderId == null ? null : senderRows.find((s) => s.id === m.senderId)?.username ?? `user ${m.senderId}`,
        type: m.messageType, hidden: m.hiddenAt != null, text: m.content.length > 1000 ? `${m.content.slice(0, 1000)}…` : m.content,
      }));
      const events = await db.select({ at: requestLifecycleEvents.createdAt, event: requestLifecycleEvents.eventType }).from(requestLifecycleEvents)
        .where(eq(requestLifecycleEvents.requestId, r.id)).orderBy(asc(requestLifecycleEvents.createdAt)).limit(200);
      timeline = events.map((e) => ({ at: e.at.toISOString(), event: e.event }));
      const verifications = await db.select({ photos: itemConditionVerifications.photos }).from(itemConditionVerifications).where(eq(itemConditionVerifications.itemId, row.itemId));
      conditionPhotos = verifications.flatMap((v) => v.photos ?? []);
    }
  }

  const ownerEvidence = await db.select().from(disputeEvidence).where(eq(disputeEvidence.disputeId, disputeId)).orderBy(asc(disputeEvidence.createdAt));
  const photos = [...new Set([...(itemInfo?.photos ?? []), ...conditionPhotos, ...ownerEvidence.flatMap((e) => e.photoUrls ?? [])])];

  const bundle = {
    dispute: {
      id: dispute.disputeId, paymentIntentId: dispute.paymentIntentId, reason: dispute.reason, amountCents: dispute.amountCents, currency: dispute.currency,
      feeCents: dispute.feeCents, outcome: dispute.outcome, evidenceDueBy: iso(dispute.evidenceDueBy), reviewStatus: dispute.reviewStatus,
      evidenceSubmittedToStripeAt: iso(dispute.evidenceSubmittedToStripeAt), rentalWasOpenWhenDisputed: dispute.rentalWasOpen,
    },
    owner: nameOf(dispute.ownerId),
    borrower: nameOf(dispute.borrowerId),
    item: itemInfo,
    request,
    timeline,
    conversation,
    ownerEvidence: ownerEvidence.map((e) => ({ at: iso(e.createdAt), note: e.note, photoUrls: e.photoUrls ?? [] })),
    photos,
  };
  return bundle;
}

/** Everything the platform knows about the disputed rental plus what the owner sent, with a paste-ready text summary. Null for an unknown dispute. */
export async function buildEvidenceBundle(disputeId: string) {
  const bundle = await collectBundle(disputeId);
  return bundle ? { ...bundle, summaryText: evidenceSummaryText(bundle) } : null;
}

/** Plain text an admin can paste into Stripe's evidence form (its "uncategorized text" field takes up to 150,000 characters). */
export function evidenceSummaryText(b: NonNullable<Awaited<ReturnType<typeof collectBundle>>>): string {
  const lines: string[] = [];
  const req: any = b.request;
  lines.push(`Dispute ${b.dispute.id}${b.dispute.reason ? ` (${b.dispute.reason})` : ""}. ShareSwap is a peer-to-peer rental marketplace; ${b.owner ?? "the owner"} lent ${b.item ? `"${b.item.name}"` : "an item"} to ${b.borrower ?? "the borrower"}.`);
  if (req) {
    lines.push(`Rental: ${req.startDate ?? "?"} to ${req.endDate ?? "?"}, status ${req.status}.`);
    const h = req.handoff;
    lines.push(`Handoff: owner confirmed ${h.ownerConfirmed ? `at ${h.ownerConfirmedAt}` : "no"}; borrower confirmed ${h.borrowerConfirmed ? `at ${h.borrowerConfirmedAt}` : "no"}${h.method ? `; confirmation method ${h.method}` : ""}${h.autoAdvancedAfterTimeout ? "; the second confirmation timed out and the handoff advanced automatically" : ""}.`);
    const ret = req.return;
    if (ret.ownerConfirmed || ret.borrowerConfirmed) lines.push(`Return: owner confirmed ${ret.ownerConfirmed ? `at ${ret.ownerConfirmedAt}` : "no"}; borrower confirmed ${ret.borrowerConfirmed ? `at ${ret.borrowerConfirmedAt}` : "no"}.`);
  }
  if (b.timeline.length) lines.push(`Timeline: ${b.timeline.map((e) => `${e.at} ${e.event}`).join("; ")}.`);
  for (const e of b.ownerEvidence) lines.push(`Owner statement (${e.at}): ${e.note ?? "(photos only)"}`);
  if (b.conversation.length) {
    lines.push(`Messages between the two members (${b.conversation.length}):`);
    for (const m of b.conversation) lines.push(`  ${m.at} ${m.from ?? "system"}${m.hidden ? " [hidden by a moderator]" : ""}: ${m.text}`);
  }
  if (b.photos.length) lines.push(`Photo files (${b.photos.length}): ${b.photos.join(" , ")}`);
  return lines.join("\n");
}
