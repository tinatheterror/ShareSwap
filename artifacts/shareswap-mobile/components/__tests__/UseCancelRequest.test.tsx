import React, { act } from "react";
import renderer from "react-test-renderer";
import { useCancelRequest } from "@/hooks/useCancelRequest";

// The flow both apps share, run here with mobile's React: tap Cancel -> the server decides -> maybe the
// penalty modal -> "Proceed to cancel" sends it again with the acknowledgment.

const penaltyError = () =>
  Object.assign(new Error("Cancelling will result in a −5 Trust Score penalty."), {
    status: 409,
    code: "PENALTY_ACK_REQUIRED",
    error: "Cancelling will result in a −5 Trust Score penalty.",
    penalty: { points: 5, type: "cancel_after_deposit" },
  });

type Api = ReturnType<typeof useCancelRequest>;

function mount(send: (id: number, body: unknown) => Promise<unknown>) {
  const onDone = jest.fn();
  const onError = jest.fn();
  const ref: { current: Api | null } = { current: null };
  function Harness() {
    ref.current = useCancelRequest({ send, onDone, onError });
    return null;
  }
  let tree!: renderer.ReactTestRenderer;
  act(() => { tree = renderer.create(<Harness />); });
  return { api: () => ref.current!, onDone, onError, unmount: () => act(() => { tree.unmount(); }) };
}

const context = { requestId: 7, role: "requester" as const, otherPartyName: "Sam" };

describe("useCancelRequest on mobile", () => {
  it("a free cancel is one call with no body, no modal, and a done callback with the server's sentence", async () => {
    const send = jest.fn(async () => ({ success: true, message: "Request cancelled. Nothing was charged." }));
    const { api, onDone, unmount } = mount(send);

    await act(async () => { await api().cancel(context); });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(7, {});
    expect(api().prompt).toBeNull();
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ kind: "done", message: "Request cancelled. Nothing was charged." }), context);
    unmount();
  });

  it("a 409 opens the penalty modal; Proceed to cancel re-sends with the acknowledgment and closes it", async () => {
    const send = jest.fn()
      .mockRejectedValueOnce(penaltyError())
      .mockResolvedValueOnce({ success: true, message: "Request cancelled. Your $42 temporary hold was released. You were not charged. A trust score penalty of -5 was applied." });
    const { api, onDone, unmount } = mount(send);

    await act(async () => { await api().cancel(context); });
    expect(api().prompt?.spec).toMatchObject({
      title: "Cancel this booking?",
      message: "Cancelling will result in a −5 Trust Score penalty.",
      keepLabel: "Keep booking",
      confirmLabel: "Proceed to cancel",
      primary: "keep",
    });
    expect(onDone).not.toHaveBeenCalled();

    await act(async () => { await api().proceed(); });

    expect(send).toHaveBeenNthCalledWith(1, 7, {});
    expect(send).toHaveBeenNthCalledWith(2, 7, { acknowledgePenalty: 5 });
    expect(api().prompt).toBeNull();
    expect(onDone).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("Keep booking closes the modal and cancels nothing", async () => {
    const send = jest.fn().mockRejectedValue(penaltyError());
    const { api, onDone, onError, unmount } = mount(send);
    await act(async () => { await api().cancel(context); });
    expect(api().prompt).not.toBeNull();

    act(() => api().dismiss());

    expect(api().prompt).toBeNull();
    expect(send).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    unmount();
  });

  it("a failed cancel reports the server's wording and leaves no modal", async () => {
    const send = jest.fn().mockRejectedValue(Object.assign(new Error("We couldn't release your payment. Nothing was changed — please try again."), { code: "REFUND_FAILED", retryable: true }));
    const { api, onError, unmount } = mount(send);
    await act(async () => { await api().cancel(context); });
    expect(api().prompt).toBeNull();
    expect(onError).toHaveBeenCalledWith("We couldn't release your payment. Nothing was changed — please try again.", expect.objectContaining({ retryable: true }));
    unmount();
  });

  it("a second tap while one is in flight is ignored", async () => {
    let release!: (value: unknown) => void;
    const send = jest.fn(() => new Promise((resolve) => { release = resolve; }));
    const { api, unmount } = mount(send);

    let first!: Promise<void>;
    act(() => { first = api().cancel(context); });
    expect(api().pending).toBe(true);
    await act(async () => { await api().cancel(context); });
    expect(send).toHaveBeenCalledTimes(1);

    await act(async () => { release({ message: "Request cancelled." }); await first; });
    expect(api().pending).toBe(false);
    unmount();
  });
});
