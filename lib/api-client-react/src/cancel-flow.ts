// How the apps cancel a request, shared by web and mobile (import from "@workspace/api-client-react/cancel-flow").
//
//   - BORROW and RENT: the app just sends the cancel. No confirmation first. The server knows whether a
//     deposit was placed; if it was, it answers 409 PENALTY_ACK_REQUIRED and the app shows the penalty
//     modal. "Proceed to cancel" sends the cancel again with the acknowledgment; "Continue with
//     transaction" (the default action) closes the modal and nothing happens.
//   - SWAP and GIFT keep their old confirmation dialogs (and their old server rule), now drawn with the
//     same modal instead of window.confirm / Alert.alert, which cannot label buttons (and do nothing at
//     all for multi-button alerts on react-native-web).

export const PENALTY_ACK_REQUIRED_CODE = "PENALTY_ACK_REQUIRED";
export const CANCEL_PENALTY_POINTS = 5;
export const PENALTY_MODAL_TEXT = `Cancelling will result in a −${CANCEL_PENALTY_POINTS} Trust Score penalty.`;
export const PENALTY_MODAL_HINT = "If you still want to proceed, you can cancel below.";
export const PROCEED_TO_CANCEL = "Proceed to cancel";
export const CONTINUE_WITH_TRANSACTION = "Continue with transaction";

export type CancelRole = "requester" | "owner";
export type CancelPlatform = "web" | "mobile";

export interface CancelTarget {
  requestType: string;
  status: string;
  role: CancelRole;
}

/** BORROW and RENT cancels are decided by the server (free, or penalty after an acknowledgment). */
export function isServerDecidedCancel(requestType: string): boolean {
  return requestType === "BORROW" || requestType === "RENT";
}

/**
 * What a Cancel button does for this person on this request:
 *   "direct"  send the cancel right away (the server answers 409 if there is a penalty to acknowledge)
 *   "confirm" ask first with the old dialog (SWAP, GIFT)
 *   "none"    no Cancel button
 * The PENDING button also depends on the negotiation state, which the screens check themselves.
 */
export function cancelAction(target: CancelTarget): "direct" | "confirm" | "none" {
  const { requestType, status, role } = target;
  if (isServerDecidedCancel(requestType)) {
    if (role === "requester") return ["PENDING", "ACCEPTED", "DEPOSIT_CONFIRMED"].includes(status) ? "direct" : "none";
    // Owners cancel an accepted request (a pending one is declined instead).
    return ["ACCEPTED", "DEPOSIT_CONFIRMED"].includes(status) ? "direct" : "none";
  }
  if (requestType === "GIFT" && role === "owner") return status === "ACCEPTED" ? "confirm" : "none";
  if (role === "requester") {
    if (status === "PENDING") return "direct";
    return ["ACCEPTED", "DEPOSIT_CONFIRMED"].includes(status) ? "confirm" : "none";
  }
  return "none";
}

export interface CancelDialogSpec {
  title: string;
  message: string;
  /** A smaller second line under the message. */
  hint?: string;
  confirmLabel: string;
  keepLabel: string;
  /** Which button is the visually primary / default one. */
  primary: "keep" | "confirm";
}

/**
 * The -5 modal. The server's own sentence is used when it sent one, so the two never drift apart.
 * otherPartyName is accepted but no longer shown: the hint no longer names the other person.
 */
export function penaltyDialog(options: { role: CancelRole; otherPartyName?: string | null; serverError?: string | null }): CancelDialogSpec {
  return {
    title: options.role === "owner" ? "Cancel this request?" : "Cancel this booking?",
    message: options.serverError?.trim() || PENALTY_MODAL_TEXT,
    hint: PENALTY_MODAL_HINT,
    confirmLabel: PROCEED_TO_CANCEL,
    keepLabel: CONTINUE_WITH_TRANSACTION,
    primary: "keep",
  };
}

/**
 * The confirmation SWAP and GIFT still show before cancelling, with the wording each app already had.
 * BORROW and RENT never get one (null). "Cancel this gift?" is only ever for an owner's accepted GIFT.
 */
export function legacyCancelDialog(target: CancelTarget, platform: CancelPlatform): CancelDialogSpec | null {
  if (cancelAction(target) !== "confirm") return null;
  const { requestType, status, role } = target;
  // The old dialogs keep their look: "Cancel" is the emphasised button.
  const keepBooking = { keepLabel: "Keep booking", confirmLabel: "Cancel", primary: "confirm" as const };

  if (requestType === "GIFT" && role === "owner") {
    return platform === "mobile"
      ? { title: "Cancel this gift?", message: "The requester will be notified.", keepLabel: "Keep it", confirmLabel: "Cancel", primary: "confirm" }
      : { title: "Cancel this booking?", message: "", ...keepBooking };
  }
  if (status === "DEPOSIT_CONFIRMED") {
    return {
      title: "Cancel this booking?",
      message: platform === "mobile"
        ? "Your temporary hold will be released. You will not be charged."
        : "Your deposit hold will be released automatically — you will not be charged.",
      ...keepBooking,
    };
  }
  return {
    title: platform === "mobile" ? "Cancel request?" : "Cancel this booking?",
    message: "The owner has already accepted your request.",
    ...keepBooking,
  };
}

// ── Talking to the server ─────────────────────────────────────────────────────

export interface CancelBody {
  reason?: string;
  acknowledgePenalty?: number;
}

export type CancelAttempt =
  | { kind: "done"; alreadyCancelled: boolean; message: string; penaltyApplied: boolean }
  | { kind: "ack_required"; error: string; points: number }
  | { kind: "failed"; message: string; retryable: boolean; code?: string };

const GENERIC_FAILURE = "Could not cancel the request. Please try again.";

export function interpretCancelSuccess(body: any): CancelAttempt {
  return {
    kind: "done",
    alreadyCancelled: body?.alreadyCancelled === true,
    message: typeof body?.message === "string" && body.message ? body.message : "Request cancelled.",
    penaltyApplied: body?.outcome?.penaltyApplied === true,
  };
}

/** The apps' API helpers throw an Error carrying the response body's fields (code, error, penalty ...). */
export function interpretCancelError(error: any): CancelAttempt {
  if (error?.code === PENALTY_ACK_REQUIRED_CODE) {
    const points = Number(error?.penalty?.points);
    return {
      kind: "ack_required",
      error: typeof error?.error === "string" && error.error ? error.error : PENALTY_MODAL_TEXT,
      points: Number.isFinite(points) && points > 0 ? points : CANCEL_PENALTY_POINTS,
    };
  }
  return {
    kind: "failed",
    message: typeof error?.message === "string" && error.message ? error.message : GENERIC_FAILURE,
    retryable: error?.retryable === true,
    code: typeof error?.code === "string" ? error.code : undefined,
  };
}

/** Sends one cancel. With `acknowledged` the body carries the acknowledgment the server asked for. */
export async function submitCancel(
  send: (body: CancelBody) => Promise<unknown>,
  options: { acknowledged?: boolean; reason?: string } = {},
): Promise<CancelAttempt> {
  const body: CancelBody = {};
  if (options.reason) body.reason = options.reason;
  if (options.acknowledged) body.acknowledgePenalty = CANCEL_PENALTY_POINTS;
  try {
    return interpretCancelSuccess(await send(body));
  } catch (error) {
    return interpretCancelError(error);
  }
}

/** A toast for a finished cancel: "Request cancelled" and then what was released or refunded. */
export function cancelToast(done: { alreadyCancelled: boolean; message: string }): { title: string; description?: string } {
  if (done.alreadyCancelled) return { title: "Already cancelled" };
  const lead = "Request cancelled.";
  if (done.message.startsWith(lead)) {
    const rest = done.message.slice(lead.length).trim();
    return { title: "Request cancelled", description: rest || undefined };
  }
  return { title: "Request cancelled", description: done.message };
}

// ── The flow, as a hook both apps use ─────────────────────────────────────────

export interface CancelContext {
  requestId: number;
  role: CancelRole;
  otherPartyName?: string | null;
  reason?: string;
}

export interface CancelPrompt {
  context: CancelContext;
  spec: CancelDialogSpec;
}

export interface UseCancelRequestOptions {
  /** POSTs /api/requests/:id/cancel with the body and returns the parsed JSON (or throws the API error). */
  send: (requestId: number, body: CancelBody) => Promise<unknown>;
  onDone: (done: Extract<CancelAttempt, { kind: "done" }>, context: CancelContext) => void;
  onError: (message: string, failure: Extract<CancelAttempt, { kind: "failed" }>) => void;
}

/**
 * The React hooks this file needs, passed in rather than imported: this package does not depend on
 * React itself (each app does), and web and mobile must run the very same flow code.
 */
export interface ReactHooks {
  useState: (initial: any) => [any, (value: any) => void];
  useRef: (initial: any) => { current: any };
  useCallback: (fn: any, deps: readonly unknown[]) => any;
}

export interface CancelRequestApi {
  /** Send the cancel. BORROW/RENT go straight to the server; a penalty to acknowledge opens `prompt`. */
  cancel: (context: CancelContext) => Promise<void>;
  /** "Proceed to cancel": send it again with the acknowledgment. */
  proceed: () => Promise<void>;
  /** "Continue with transaction": close the modal; nothing was cancelled. */
  dismiss: () => void;
  prompt: CancelPrompt | null;
  pending: boolean;
  pendingId: number | null;
}

/** Each app does `export const useCancelRequest = createUseCancelRequest(React)` once. */
export function createUseCancelRequest(react: ReactHooks) {
  return function useCancelRequest(options: UseCancelRequestOptions): CancelRequestApi {
    const [prompt, setPrompt] = react.useState(null) as [CancelPrompt | null, (value: CancelPrompt | null) => void];
    const [pendingId, setPendingId] = react.useState(null) as [number | null, (value: number | null) => void];
    const inFlight = react.useRef(false);
    const latest = react.useRef(options);
    latest.current = options;

    const attempt = react.useCallback(async (context: CancelContext, acknowledged: boolean) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setPendingId(context.requestId);
      try {
        const result = await submitCancel((body) => latest.current.send(context.requestId, body), {
          acknowledged,
          reason: context.reason,
        });
        if (result.kind === "ack_required") {
          setPrompt({ context, spec: penaltyDialog({ role: context.role, otherPartyName: context.otherPartyName, serverError: result.error }) });
        } else if (result.kind === "done") {
          setPrompt(null);
          latest.current.onDone(result, context);
        } else {
          setPrompt(null);
          latest.current.onError(result.message, result);
        }
      } finally {
        inFlight.current = false;
        setPendingId(null);
      }
    }, []) as (context: CancelContext, acknowledged: boolean) => Promise<void>;

    return {
      cancel: (context) => attempt(context, false),
      proceed: () => (prompt ? attempt(prompt.context, true) : Promise.resolve()),
      dismiss: () => setPrompt(null),
      prompt,
      pending: pendingId !== null,
      pendingId,
    };
  };
}
