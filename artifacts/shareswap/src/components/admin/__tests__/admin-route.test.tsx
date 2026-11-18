import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

let authState: { user: unknown; isLoading: boolean } = { user: null, isLoading: false };
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => authState }));

import { AdminRoute } from "../admin-route";

afterEach(cleanup);

const Page = () => <div data-testid="handoff-disputes-page">the admin queue</div>;

function open(path: string) {
  const { hook, history } = memoryLocation({ path, record: true });
  const view = render(
    <Router hook={hook}>
      <AdminRoute path="/admin/handoff-disputes" component={Page} />
    </Router>,
  );
  return { view, location: () => history![history!.length - 1] };
}

describe("AdminRoute (the Handoff disputes page)", () => {
  it("shows the page to an admin", () => {
    authState = { user: { id: 1, isAdmin: true }, isLoading: false };
    open("/admin/handoff-disputes");
    expect(screen.getByTestId("handoff-disputes-page")).toBeTruthy();
  });

  it("never renders it for a signed-in member who is not an admin, and sends them home", () => {
    authState = { user: { id: 2, isAdmin: false }, isLoading: false };
    const { location } = open("/admin/handoff-disputes");
    expect(screen.queryByTestId("handoff-disputes-page")).toBeNull();
    expect(location()).toBe("/");
  });

  it("never renders it for a visitor who is signed out, and sends them to sign in", () => {
    authState = { user: null, isLoading: false };
    const { location } = open("/admin/handoff-disputes");
    expect(screen.queryByTestId("handoff-disputes-page")).toBeNull();
    expect(location()).toBe("/auth");
  });

  it("renders nothing while the account is still loading", () => {
    authState = { user: null, isLoading: true };
    open("/admin/handoff-disputes");
    expect(screen.queryByTestId("handoff-disputes-page")).toBeNull();
  });
});
