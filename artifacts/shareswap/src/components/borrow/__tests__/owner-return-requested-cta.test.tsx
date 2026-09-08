import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OwnerReturnRequestedCta } from "../owner-return-requested-cta";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderCta({
  status = "RETURN_REQUESTED",
  response,
}: {
  status?: string;
  response?: Promise<Response>;
} = {}) {
  if (response) vi.stubGlobal("fetch", vi.fn(() => response));
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const openConfirmation = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <OwnerReturnRequestedCta
        requestId={42}
        status={status}
        requestType="BORROW"
        onConfirm={openConfirmation}
      />
    </QueryClientProvider>,
  );
  return openConfirmation;
}

describe("OwnerReturnRequestedCta", () => {
  it("keeps Confirm return available while lifecycle permissions are loading", () => {
    const openConfirmation = renderCta({
      response: new Promise(() => {}),
    });

    fireEvent.click(screen.getByRole("button", { name: "Confirm return" }));
    expect(openConfirmation).toHaveBeenCalledOnce();
    expect(screen.getByText("Checking the latest return permissions…")).toBeInTheDocument();
  });

  it("keeps Confirm return available when lifecycle permissions fail to load", async () => {
    const openConfirmation = renderCta({
      response: Promise.resolve(new Response(null, { status: 500 })),
    });

    fireEvent.click(await screen.findByRole("button", { name: "Confirm return" }));
    expect(openConfirmation).toHaveBeenCalledOnce();
    expect(
      await screen.findByText(
        "Couldn’t refresh return permissions. The server will verify before confirming.",
      ),
    ).toBeInTheDocument();
  });

  it("uses lifecycle actions over a disagreeing request status", async () => {
    renderCta({
      response: Promise.resolve(
        new Response(JSON.stringify({ lifecycle: { stage: "RETURN_REQUESTED", actions: [] } })),
      ),
    });

    expect(await screen.findByRole("button", { name: "Confirm return" })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Confirm return" })).not.toBeInTheDocument();
    });
  });

  it("keeps Confirm return available when the lifecycle is seriously overdue", async () => {
    const openConfirmation = renderCta({
      response: Promise.resolve(
        new Response(
          JSON.stringify({
            lifecycle: {
              stage: "SERIOUSLY_OVERDUE",
              actions: ["confirm_return"],
            },
          }),
        ),
      ),
    });

    fireEvent.click(
      await screen.findByRole("button", { name: "Confirm return" }),
    );
    expect(openConfirmation).toHaveBeenCalledOnce();
  });

  it("shows Confirm return when lifecycle actions allow it despite stale local status", async () => {
    const openConfirmation = renderCta({
      status: "IN_PROGRESS",
      response: Promise.resolve(
        new Response(
          JSON.stringify({
            lifecycle: {
              stage: "SERIOUSLY_OVERDUE",
              actions: ["confirm_return"],
            },
          }),
        ),
      ),
    });

    fireEvent.click(
      await screen.findByRole("button", { name: "Confirm return" }),
    );
    expect(openConfirmation).toHaveBeenCalledOnce();
  });

  it("does not show the action before a return is requested", () => {
    renderCta({ status: "IN_PROGRESS", response: new Promise(() => {}) });

    expect(screen.queryByRole("button", { name: "Confirm return" })).not.toBeInTheDocument();
  });
});