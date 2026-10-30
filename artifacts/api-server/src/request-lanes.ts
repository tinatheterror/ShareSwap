import { formatHandoffCutoff, requestCalendarDay, returnDueDay, timezoneForRequest } from "./request-dates";

/**
 * Which part of the Requests screen a request belongs to for one viewer. The server decides this once so the
 * web page and the mobile inbox group requests the same way:
 *  - action: the viewer has something to do now;
 *  - in_progress: the request is live and the viewer is waiting on someone (or on time passing);
 *  - history: finished, cancelled, declined or expired.
 */
export type RequestSection = "action" | "in_progress" | "history";

export type RequestLane = {
  section: RequestSection;
  /** What the viewer is asked to do ("Leave a review"); null outside the action section. */
  actionLabel: string | null;
  /** One line on where the request stands, including who or what it waits on and any due date. */
  statusLine: string;
  /** The date the status line refers to, as YYYY-MM-DD in the request's zone; null when it has none. */
  dueDay: string | null;
};

/** How long after completion a missing review keeps a request in "Needs your action". */
export const REVIEW_WINDOW_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Statuses that end a booking (same list the account-deletion check uses). */
const HISTORY_STATUSES = new Set(["CANCELLED", "DECLINED", "REJECTED", "EXPIRED", "DEPOSIT_FAILED"]);
const COMPLETED_STATUSES = new Set(["COMPLETED", "COMPLETED_EARLY"]);
/** The borrower has to hand the item back now, or already should have. */
const RETURN_DUE_STATUSES = new Set(["RETURN_DUE", "OVERDUE_GRACE", "OVERDUE", "SERIOUSLY_OVERDUE"]);

export type LaneInput = {
  status: string;
  requestType: string;
  requesterId: number | null;
  ownerId: number | null;
  negotiationStatus?: string | null;
  counterProposedBy?: number | null;
  ownerConfirmedHandoff?: boolean | null;
  borrowerConfirmedHandoff?: boolean | null;
  handoffConfirmDeadline?: Date | string | null;
  endDate?: Date | string | null;
  returnDeadlineAt?: Date | string | null;
  /** When the request completed; see deriveCompletedAt. */
  completedAt?: Date | string | null;
  /** The viewer already left a review for this request. */
  reviewedByViewer?: boolean | null;
  /** An extension the borrower asked for is waiting on the owner. */
  pendingExtension?: boolean;
};

export type CompletedAtSource = {
  returnConfirmedAt?: Date | null;
  actualReturnAt?: Date | null;
  ownerConfirmedReturnAt?: Date | null;
  depositReleasedAt?: Date | null;
  handoffConfirmedAt?: Date | null;
  actualHandoffAt?: Date | null;
  createdAt?: Date | null;
};

/**
 * Requests have no completed_at column, and several paths set COMPLETED without a timestamp of their own,
 * so use the last step that is recorded: the return for a loan, the handoff for a gift or swap.
 */
export function deriveCompletedAt(r: CompletedAtSource): Date | null {
  return r.returnConfirmedAt ?? r.actualReturnAt ?? r.ownerConfirmedReturnAt ?? r.depositReleasedAt
    ?? r.handoffConfirmedAt ?? r.actualHandoffAt ?? r.createdAt ?? null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function formatDay(day: string): string {
  const [, m, d] = day.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}
const withDue = (line: string, day: string | null) => (day ? `${line} · due ${formatDay(day)}` : line);

function baseLane(input: LaneInput, viewerId: number, otherParty: string, now: Date): RequestLane {
  const isOwner = input.ownerId === viewerId;
  const isBorrower = !isOwner;
  const kind = input.requestType;
  const action = (actionLabel: string, statusLine: string, dueDay: string | null = null): RequestLane =>
    ({ section: "action", actionLabel, statusLine, dueDay });
  const progress = (statusLine: string, dueDay: string | null = null): RequestLane =>
    ({ section: "in_progress", actionLabel: null, statusLine, dueDay });
  const history = (statusLine: string): RequestLane =>
    ({ section: "history", actionLabel: null, statusLine, dueDay: null });

  const status = input.status;

  if (COMPLETED_STATUSES.has(status)) {
    const completedAt = input.completedAt ? new Date(input.completedAt) : null;
    const reviewUntil = completedAt ? completedAt.getTime() + REVIEW_WINDOW_DAYS * DAY_MS : null;
    if (!input.reviewedByViewer && reviewUntil !== null && now.getTime() <= reviewUntil) {
      const dueDay = requestCalendarDay(new Date(reviewUntil));
      return action("Leave a review", `Completed · review ${otherParty} by ${formatDay(dueDay!)}`, dueDay);
    }
    return history("Completed");
  }
  if (HISTORY_STATUSES.has(status)) {
    return history({ CANCELLED: "Cancelled", DECLINED: "Declined", REJECTED: "Declined", EXPIRED: "Expired", DEPOSIT_FAILED: "Deposit failed" }[status]!);
  }

  // A counter-offer is waiting on whoever did not make it, whatever the status.
  if (input.negotiationStatus === "counter_proposed") {
    return input.counterProposedBy === viewerId
      ? progress(`Waiting on ${otherParty} to answer your counter-offer`)
      : action("Respond to counter-offer", `${otherParty} sent a counter-offer`);
  }

  const returnDay = returnDueDay({ returnDeadlineAt: input.returnDeadlineAt, endDate: input.endDate });
  const lend = kind === "BORROW" || kind === "RENT";

  switch (status) {
    case "PENDING":
      return isOwner
        ? action("Accept or decline", `${otherParty} is waiting for your answer`)
        : progress(`Waiting on ${otherParty} to respond`);

    case "ACCEPTED":
      if (kind === "GIFT") {
        return isBorrower
          ? action("Enter handoff code", `Ask ${otherParty} for the handoff code after pickup`)
          : progress(`Waiting on ${otherParty} to pick up the gift`);
      }
      if (kind === "SWAP") return progress(`Arrange the exchange with ${otherParty}`);
      return isBorrower
        ? action(kind === "RENT" ? "Pay rental & place deposit hold" : "Place deposit hold", `Accepted by ${otherParty}`)
        : progress(`Waiting on ${otherParty} to place the deposit hold`);

    case "DEPOSIT_PENDING":
      return isBorrower
        ? action("Finish deposit payment", "Your deposit hold is not complete")
        : progress(`Waiting on ${otherParty} to finish the deposit payment`);

    case "DEPOSIT_CONFIRMED":
      return action("Confirm handoff", `Deposit held · confirm the handoff with ${otherParty}`);

    case "AWAITING_HANDOFF_CONFIRM": {
      const confirmed = isOwner ? input.ownerConfirmedHandoff : input.borrowerConfirmedHandoff;
      if (!confirmed) return action("Confirm handoff", `${otherParty} is waiting for you to confirm the handoff`);
      const deadline = input.handoffConfirmDeadline ? new Date(input.handoffConfirmDeadline) : null;
      const by = deadline ? ` by ${formatHandoffCutoff(deadline, timezoneForRequest())}` : "";
      return progress(`Waiting on ${otherParty} to confirm the handoff${by}`, deadline ? requestCalendarDay(deadline) : null);
    }

    case "HANDOFF_CONFIRMED":
    case "IN_PROGRESS":
      if (!lend) return progress("In progress");
      return isBorrower
        ? progress(returnDay ? `Return by ${formatDay(returnDay)}` : "Return when you are done", returnDay)
        : progress(withDue(`${otherParty} has your item`, returnDay), returnDay);

    case "RETURN_DUE":
    case "OVERDUE_GRACE":
    case "OVERDUE":
    case "SERIOUSLY_OVERDUE": {
      const overdue = status !== "RETURN_DUE";
      if (isBorrower) return action("Return the item", `${overdue ? "Overdue" : "Return due"}${returnDay ? ` since ${formatDay(returnDay)}` : ""}`, returnDay);
      return progress(`Waiting on ${otherParty} to return your item${overdue ? " (overdue)" : ""}`, returnDay);
    }

    case "RETURN_REQUESTED":
    case "RETURNED_PENDING_REVIEW":
      return isOwner
        ? action("Confirm return", `${otherParty} says the item is back`)
        : progress(`Waiting on ${otherParty} to confirm the return`);

    // The owner has nothing left to do once the return is confirmed; only the deposit release is outstanding.
    case "RETURN_CONFIRMED":
      return progress("Return confirmed · deposit release pending");

    case "DISPUTED":
    case "HANDOFF_DISPUTED":
    case "HANDOFF_FLAGGED":
    case "NON_RETURN_REVIEW":
      return progress("Under ShareSwap review");

    default:
      // A status added later is still live (the deletion check treats it as blocking too).
      return progress("In progress");
  }
}

/** `otherParty` is how the viewer sees the other person ("Sam"). */
export function classifyRequestLane(input: LaneInput, viewerId: number, otherParty: string, now: Date): RequestLane {
  const lane = baseLane(input, viewerId, otherParty, now);
  if (!input.pendingExtension || lane.section === "history") return lane;
  // An extension request from the borrower waits on the owner, whatever else the status says.
  return input.ownerId === viewerId
    ? { section: "action", actionLabel: "Respond to extension request", statusLine: `${otherParty} asked for more time`, dueDay: lane.dueDay }
    : { ...lane, statusLine: `${lane.statusLine} · extension request sent` };
}
