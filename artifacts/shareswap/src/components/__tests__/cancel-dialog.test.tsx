import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { legacyCancelDialog, penaltyDialog } from "@workspace/api-client-react/cancel-flow";
import { CancelDialog } from "../cancel-dialog";

afterEach(cleanup);

describe("web CancelDialog", () => {
  it("shows the penalty text with both buttons, Continue first and emphasised", () => {
    const onConfirm = vi.fn();
    const onKeep = vi.fn();
    render(<CancelDialog spec={penaltyDialog({ role: "requester", otherPartyName: "Sam" })} pending={false} onConfirm={onConfirm} onKeep={onKeep} />);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("A trust score penalty of -5 will be applied for this cancellation")).toBeInTheDocument();
    expect(screen.getByTestId("cancel-dialog-hint")).toHaveTextContent("message Sam to agree a change first");

    const buttons = screen.getAllByRole("button").filter((b) => b.getAttribute("data-testid")?.startsWith("cancel-dialog-"));
    expect(buttons.map((b) => b.textContent)).toEqual(["Continue with transaction", "Proceed to cancel"]);
    const keep = screen.getByTestId("cancel-dialog-keep");
    const confirm = screen.getByTestId("cancel-dialog-confirm");
    expect(keep.className).toContain("bg-primary");
    expect(confirm.className).not.toContain("bg-primary");

    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onKeep).not.toHaveBeenCalled();
    fireEvent.click(keep);
    expect(onKeep).toHaveBeenCalledTimes(1);
  });

  it("is closed without a spec, and locks both buttons while a cancel is in flight", () => {
    const { rerender } = render(<CancelDialog spec={null} pending={false} onConfirm={vi.fn()} onKeep={vi.fn()} />);
    expect(screen.queryByRole("dialog")).toBeNull();

    rerender(<CancelDialog spec={penaltyDialog({ role: "owner" })} pending onConfirm={vi.fn()} onKeep={vi.fn()} />);
    expect(screen.getByTestId("cancel-dialog-keep")).toBeDisabled();
    expect(screen.getByTestId("cancel-dialog-confirm")).toBeDisabled();
    expect(screen.getByText("Cancelling…")).toBeInTheDocument();
  });

  it("draws the old SWAP confirmation with Cancel as the emphasised button", () => {
    render(<CancelDialog spec={legacyCancelDialog({ requestType: "SWAP", status: "ACCEPTED", role: "requester" }, "web")} pending={false} onConfirm={vi.fn()} onKeep={vi.fn()} />);
    expect(screen.getByText("The owner has already accepted your request.")).toBeInTheDocument();
    expect(screen.getByTestId("cancel-dialog-keep")).toHaveTextContent("Keep booking");
    expect(screen.getByTestId("cancel-dialog-confirm")).toHaveTextContent("Cancel");
    expect(screen.getByTestId("cancel-dialog-confirm").className).toContain("bg-destructive");
  });
});
