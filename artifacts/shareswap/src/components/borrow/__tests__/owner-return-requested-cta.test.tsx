import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OwnerReturnRequestedCta } from "../owner-return-requested-cta";

afterEach(cleanup);

describe("OwnerReturnRequestedCta", () => {
  it("keeps Confirm return available for a requested return regardless of overdue lifecycle stage", () => {
    const openConfirmation = vi.fn();

    render(
      <OwnerReturnRequestedCta
        status="RETURN_REQUESTED"
        lifecycleStage="SERIOUSLY_OVERDUE"
        requestType="BORROW"
        onConfirm={openConfirmation}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Confirm return" }));
    expect(openConfirmation).toHaveBeenCalledOnce();
  });

  it("does not show the action before a return is requested", () => {
    render(
      <OwnerReturnRequestedCta
        status="IN_PROGRESS"
        requestType="BORROW"
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "Confirm return" })).not.toBeInTheDocument();
  });
});