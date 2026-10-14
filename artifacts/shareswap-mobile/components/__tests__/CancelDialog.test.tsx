import React, { act } from "react";
import renderer from "react-test-renderer";
import { Modal, Text } from "react-native";
import { legacyCancelDialog, penaltyDialog } from "@workspace/api-client-react/cancel-flow";
import { CancelDialog } from "../CancelDialog";
import { CancelOutcomeBanner } from "../CancelOutcomeBanner";

function render(element: React.ReactElement) {
  let tree!: renderer.ReactTestRenderer;
  act(() => { tree = renderer.create(element); });
  return tree;
}
const texts = (tree: renderer.ReactTestRenderer) =>
  tree.root.findAllByType(Text).map((node) => [node.props.children].flat().join(""));
const byTestId = (tree: renderer.ReactTestRenderer, id: string) => tree.root.findByProps({ testID: id });

describe("mobile CancelDialog", () => {
  let tree: renderer.ReactTestRenderer | undefined;
  afterEach(() => {
    if (tree) act(() => { tree!.unmount(); });
    tree = undefined;
  });

  it("shows the penalty text with both buttons, Continue first and the default", () => {
    const onConfirm = jest.fn();
    const onKeep = jest.fn();
    tree = render(<CancelDialog spec={penaltyDialog({ role: "requester", otherPartyName: "Sam" })} pending={false} onConfirm={onConfirm} onKeep={onKeep} />);

    expect(tree.root.findByType(Modal).props.visible).toBe(true);
    expect(texts(tree)).toEqual([
      "Cancel this booking?",
      "A trust score penalty of -5 will be applied for this cancellation",
      "If plans have changed, message Sam to agree a change first.",
      "Continue with transaction",
      "Proceed to cancel",
    ]);

    const keep = byTestId(tree, "cancel-dialog-keep");
    const confirm = byTestId(tree, "cancel-dialog-confirm");
    // Continue with transaction is the filled button; Proceed to cancel is outlined, with no fill.
    const background = (node: renderer.ReactTestInstance) => [node.props.style].flat(3).find((style) => style && typeof style === "object" && "backgroundColor" in style)?.backgroundColor;
    expect(background(keep)).toBe("#0DCEA1");
    expect(background(confirm)).toBe("transparent");

    act(() => { confirm.props.onPress(); });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onKeep).not.toHaveBeenCalled();
    act(() => { keep.props.onPress(); });
    expect(onKeep).toHaveBeenCalledTimes(1);
  });

  it("is hidden without a spec, and both buttons are disabled while a cancel is in flight", () => {
    tree = render(<CancelDialog spec={null} pending={false} onConfirm={jest.fn()} onKeep={jest.fn()} />);
    expect(tree.root.findByType(Modal).props.visible).toBe(false);

    act(() => { tree!.update(<CancelDialog spec={penaltyDialog({ role: "owner" })} pending onConfirm={jest.fn()} onKeep={jest.fn()} />); });
    expect(byTestId(tree, "cancel-dialog-keep").props.disabled).toBe(true);
    expect(byTestId(tree, "cancel-dialog-confirm").props.disabled).toBe(true);
    expect(texts(tree)[0]).toBe("Cancel this request?");
  });

  it("the system back button on Android does not dismiss it mid-cancel", () => {
    const onKeep = jest.fn();
    tree = render(<CancelDialog spec={penaltyDialog({ role: "requester" })} pending onConfirm={jest.fn()} onKeep={onKeep} />);
    act(() => { tree!.root.findByType(Modal).props.onRequestClose(); });
    expect(onKeep).not.toHaveBeenCalled();
    act(() => { tree!.update(<CancelDialog spec={penaltyDialog({ role: "requester" })} pending={false} onConfirm={jest.fn()} onKeep={onKeep} />); });
    act(() => { tree!.root.findByType(Modal).props.onRequestClose(); });
    expect(onKeep).toHaveBeenCalledTimes(1);
  });

  it("draws the old GIFT confirmation with its own wording", () => {
    tree = render(<CancelDialog spec={legacyCancelDialog({ requestType: "GIFT", status: "ACCEPTED", role: "owner" }, "mobile")} pending={false} onConfirm={jest.fn()} onKeep={jest.fn()} />);
    expect(texts(tree)).toEqual(["Cancel this gift?", "The requester will be notified.", "Keep it", "Cancel"]);
  });
});

describe("CancelOutcomeBanner", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("shows what the cancel did and hides itself", () => {
    const onHide = jest.fn();
    const tree = render(<CancelOutcomeBanner title="Request cancelled" message="Your $42 temporary hold was released. You were not charged." onHide={onHide} hideAfterMs={5000} />);
    expect(texts(tree)).toEqual(["Request cancelled", "Your $42 temporary hold was released. You were not charged."]);
    act(() => { jest.advanceTimersByTime(4999); });
    expect(onHide).not.toHaveBeenCalled();
    act(() => { jest.advanceTimersByTime(1); });
    expect(onHide).toHaveBeenCalledTimes(1);
    act(() => { tree.unmount(); });
  });
});
