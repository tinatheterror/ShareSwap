import { useEffect, useRef } from "react";
import * as Haptics from "expo-haptics";

// A person who taps "accept" or "confirm hand-off" already feels a vibration from the button itself. The other
// person is waiting; the screen learns of the change when it re-checks the request. This buzzes for them, and
// stays quiet for the person who just did it (their own buzz was a moment ago).
let lastOwnConfirmAt = 0;
const OWN_ACTION_WINDOW_MS = 15_000;

/** Call when this device's user just confirmed something themselves, so the change they caused does not buzz again. */
export function markOwnConfirm(): void {
  lastOwnConfirmAt = Date.now();
}

type Snapshot = {
  status?: string | null;
  handoffConfirmedAt?: string | null;
  ownerConfirmedHandoff?: boolean | null;
  borrowerConfirmedHandoff?: boolean | null;
};

/** Pure rule, kept separate so it can be tested: should this change from `prev` to `next` buzz? */
export function shouldVibrateForChange(prev: Snapshot | null, next: Snapshot): boolean {
  if (!prev) return false; // first load: nothing changed yet
  if (prev.status !== "ACCEPTED" && next.status === "ACCEPTED") return true;
  if (!prev.handoffConfirmedAt && next.handoffConfirmedAt) return true;
  if (!prev.ownerConfirmedHandoff && next.ownerConfirmedHandoff) return true;
  if (!prev.borrowerConfirmedHandoff && next.borrowerConfirmedHandoff) return true;
  return false;
}

export function useRequestChangeHaptics(requestId: number | null, snapshot: Snapshot | null): void {
  const prev = useRef<{ requestId: number | null; snap: Snapshot } | null>(null);
  const status = snapshot?.status ?? null;
  const handoffConfirmedAt = snapshot?.handoffConfirmedAt ?? null;
  const ownerConfirmedHandoff = snapshot?.ownerConfirmedHandoff ?? null;
  const borrowerConfirmedHandoff = snapshot?.borrowerConfirmedHandoff ?? null;

  useEffect(() => {
    if (!snapshot) return;
    const before = prev.current && prev.current.requestId === requestId ? prev.current.snap : null;
    const next = { status, handoffConfirmedAt, ownerConfirmedHandoff, borrowerConfirmedHandoff };
    prev.current = { requestId, snap: next };
    if (!shouldVibrateForChange(before, next)) return;
    if (Date.now() - lastOwnConfirmAt < OWN_ACTION_WINDOW_MS) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId, status, handoffConfirmedAt, ownerConfirmedHandoff, borrowerConfirmedHandoff]);
}
