import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useCancelRequest } from "./use-cancel-request";

// The flow both apps share, run here with web's React: tap Cancel -> the server decides -> maybe the
// penalty modal -> "Proceed to cancel" sends it again with the acknowledgment.

const penaltyError = () =>
  Object.assign(new Error("Cancelling will result in a −5 Trust Score penalty."), {
    status: 409,
    code: "PENALTY_ACK_REQUIRED",
    error: "Cancelling will result in a −5 Trust Score penalty.",
    penalty: { points: 5, type: "cancel_after_deposit" },
  });

function setup(send: (id: number, body: unknown) => Promise<unknown>) {
  const onDone = vi.fn();
  const onError = vi.fn();
  const hook = renderHook(() => useCancelRequest({ send, onDone, onError }));
  return { ...hook, onDone, onError };
}

const context = { requestId: 7, role: "requester" as const, otherPartyName: "Sam" };

describe("useCancelRequest on web", () => {
  it("a free cancel is one call with no body, no modal, and a done callback with the server's sentence", async () => {
    const send = vi.fn(async () => ({ success: true, message: "Request cancelled. Nothing was charged." }));
    const { result, onDone } = setup(send);

    await act(async () => { await result.current.cancel(context); });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(7, {});
    expect(result.current.prompt).toBeNull();
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ kind: "done", message: "Request cancelled. Nothing was charged." }), context);
  });

  it("a 409 opens the penalty modal; Proceed to cancel re-sends with the acknowledgment and closes it", async () => {
    const send = vi.fn()
      .mockRejectedValueOnce(penaltyError())
      .mockResolvedValueOnce({ success: true, message: "Request cancelled. Your $42 temporary hold was released. You were not charged. A trust score penalty of -5 was applied." });
    const { result, onDone } = setup(send);

    await act(async () => { await result.current.cancel(context); });

    expect(result.current.prompt?.spec).toMatchObject({
      title: "Cancel this booking?",
      message: "Cancelling will result in a −5 Trust Score penalty.",
      hint: "If you still want to proceed, you can cancel below.",
      keepLabel: "Continue with transaction",
      confirmLabel: "Proceed to cancel",
      primary: "keep",
    });
    expect(onDone).not.toHaveBeenCalled();

    await act(async () => { await result.current.proceed(); });

    expect(send).toHaveBeenNthCalledWith(1, 7, {});
    expect(send).toHaveBeenNthCalledWith(2, 7, { acknowledgePenalty: 5 });
    expect(result.current.prompt).toBeNull();
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone.mock.calls[0][0].message).toMatch(/A trust score penalty of -5 was applied\.$/);
  });

  it("Continue with transaction closes the modal and cancels nothing", async () => {
    const send = vi.fn().mockRejectedValue(penaltyError());
    const { result, onDone, onError } = setup(send);
    await act(async () => { await result.current.cancel(context); });
    expect(result.current.prompt).not.toBeNull();

    act(() => result.current.dismiss());

    expect(result.current.prompt).toBeNull();
    expect(send).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("the owner sees the owner wording", async () => {
    const send = vi.fn().mockRejectedValue(penaltyError());
    const { result } = setup(send);
    await act(async () => { await result.current.cancel({ requestId: 7, role: "owner", otherPartyName: "Alex" }); });
    expect(result.current.prompt?.spec.title).toBe("Cancel this request?");
  });

  it("a failed cancel reports the server's wording and leaves no modal", async () => {
    const send = vi.fn().mockRejectedValue(Object.assign(new Error("We couldn't release your payment. Nothing was changed — please try again."), { code: "REFUND_FAILED", retryable: true }));
    const { result, onError } = setup(send);

    await act(async () => { await result.current.cancel(context); });

    expect(result.current.prompt).toBeNull();
    expect(onError).toHaveBeenCalledWith("We couldn't release your payment. Nothing was changed — please try again.", expect.objectContaining({ retryable: true }));
  });

  it("a second tap while one is in flight is ignored", async () => {
    let release!: (value: unknown) => void;
    const send = vi.fn(() => new Promise((resolve) => { release = resolve; }));
    const { result } = setup(send);

    let first!: Promise<void>;
    act(() => { first = result.current.cancel(context); });
    await waitFor(() => expect(result.current.pending).toBe(true));
    await act(async () => { await result.current.cancel(context); });
    expect(send).toHaveBeenCalledTimes(1);

    await act(async () => { release({ message: "Request cancelled." }); await first; });
    expect(result.current.pending).toBe(false);
  });

  it("if the server's amount changed between the two calls, the modal is shown again instead of cancelling", async () => {
    const send = vi.fn().mockRejectedValue(penaltyError());
    const { result, onDone } = setup(send);
    await act(async () => { await result.current.cancel(context); });
    await act(async () => { await result.current.proceed(); });
    expect(send).toHaveBeenCalledTimes(2);
    expect(result.current.prompt).not.toBeNull();
    expect(onDone).not.toHaveBeenCalled();
  });
});
