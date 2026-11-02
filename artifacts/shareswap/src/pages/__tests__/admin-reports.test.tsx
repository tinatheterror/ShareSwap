import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The page itself needs auth, routing and a query client; the card is what a moderator reads and clicks.
vi.mock("@/components/admin/admin-layout", () => ({ AdminLayout: ({ children }: { children: unknown }) => <div>{children as any}</div> }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/queryClient", () => ({ apiRequest: vi.fn(), queryClient: { invalidateQueries: vi.fn() } }));

import { ReportCard, type AdminReport } from "../admin/reports";

afterEach(cleanup);

const base: AdminReport = {
  id: 7,
  status: "open",
  targetType: "item",
  targetId: 41,
  reason: "scam",
  details: "Looks fake",
  snapshot: { name: "Vintage drill", description: "Works great\nCall me outside the app", photos: ["/uploads/a.jpg"] },
  createdAt: "2026-11-02T10:00:00.000Z",
  ageHours: 3,
  overdue: false,
  resolvedAt: null,
  resolutionNote: null,
  reporter: { id: 2, username: "reporter", displayName: "Rita" },
  author: { id: 3, username: "author", displayName: "Aaron", accountStatus: "active" },
  otherReportsAgainstAuthor: 0,
};

describe("ReportCard", () => {
  it("shows what was reported as it was, who reported it and who wrote it", () => {
    render(<ReportCard report={base} />);
    const snapshot = screen.getByTestId("report-snapshot-7");
    expect(snapshot.textContent).toContain("Vintage drill");
    expect(snapshot.textContent).toContain("Call me outside the app");
    expect(screen.getByTestId("report-7").textContent).toContain("Rita");
    expect(screen.getByTestId("report-7").textContent).toContain("Aaron");
    expect(screen.getByTestId("report-7").textContent).toContain("Looks fake");
  });

  it("flags an overdue report and says how many other reports name the same person", () => {
    render(<ReportCard report={{ ...base, overdue: true, ageHours: 22, otherReportsAgainstAuthor: 2 }} />);
    expect(screen.getByTestId("report-age-7").textContent).toMatch(/Overdue · 22h/);
    expect(screen.getByTestId("report-history-7").textContent).toBe("2 other reports against this person");
  });

  it("offers every action for content, but no 'remove content' for a profile", () => {
    const { rerender } = render(<ReportCard report={base} />);
    for (const action of ["dismiss", "remove_content", "warn_user", "ban_user"]) expect(screen.getByTestId(`report-7-${action}`)).toBeTruthy();
    rerender(<ReportCard report={{ ...base, targetType: "user", snapshot: { displayName: "Aaron", bio: "hi" } }} />);
    expect(screen.queryByTestId("report-7-remove_content")).toBeNull();
    expect(screen.getByTestId("report-7-ban_user")).toBeTruthy();
  });

  it("passes the chosen action up", () => {
    const onAction = vi.fn();
    render(<ReportCard report={base} onAction={onAction} />);
    fireEvent.click(screen.getByTestId("report-7-warn_user"));
    expect(onAction).toHaveBeenCalledWith(base, "warn_user");
  });

  it("shows a handled report as history, with no buttons", () => {
    render(<ReportCard report={{ ...base, status: "actioned", resolvedAt: "2026-11-02T12:00:00.000Z", resolutionNote: "Removed", ageHours: 5 }} />);
    expect(screen.getByTestId("report-status-7").textContent).toBe("actioned");
    expect(screen.queryByTestId("report-7-dismiss")).toBeNull();
    expect(screen.queryByTestId("report-age-7")).toBeNull();
    expect(screen.getByTestId("report-7").textContent).toContain("Removed");
  });
});
