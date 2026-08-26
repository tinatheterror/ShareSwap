import React from "react";
import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useQuery: vi.fn(),
  navigate: vi.fn(),
  Icon: () => null,
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: mocks.useQuery,
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    user: {
      id: 7,
      username: "sam",
      reputationScore: 142,
      isVerified: true,
    },
  }),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/score-history", mocks.navigate],
  useSearch: () => "",
  Link: ({ children, ...props }: React.PropsWithChildren<{ href: string }>) => (
    <a {...props}>{children}</a>
  ),
}));

vi.mock("@/components/shared/navbar", () => ({
  Navbar: () => <nav aria-label="Main navigation" />,
}));

vi.mock("@/components/ui/card", () => ({
  Card: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
    <div {...props}>{children}</div>
  ),
  CardContent: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
    <div {...props}>{children}</div>
  ),
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
    <span {...props}>{children}</span>
  ),
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: React.PropsWithChildren) => <>{children}</>,
  PopoverTrigger: ({ children }: React.PropsWithChildren) => <>{children}</>,
  PopoverContent: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));

vi.mock("lucide-react", () => {
  const iconNames = [
    "Shield",
    "BadgeCheck",
    "Handshake",
    "Gift",
    "Zap",
    "Sprout",
    "CheckCircle",
    "Heart",
    "Sparkles",
    "Star",
    "User",
    "Users",
    "ArrowLeftRight",
    "Crown",
    "Medal",
    "Gem",
    "TrendingUp",
    "Package",
    "MessageSquare",
    "Quote",
    "Trophy",
    "Flame",
    "Timer",
    "Repeat2",
    "HeartHandshake",
    "ShoppingBag",
    "Key",
    "Layers",
    "Truck",
    "Coins",
    "BookMarked",
    "Camera",
    "UserPlus",
    "Home",
    "PartyPopper",
    "ChevronRight",
    "ArrowLeft",
    "Clock",
  ];
  return Object.fromEntries(iconNames.map((name) => [name, mocks.Icon]));
});

import AchievementsPage from "../achievements-page";
import ScoreHistoryPage from "../score-history-page";

const populatedReputation = {
  reputationScore: 142,
  reputationLevel: "Neighbour",
  recentActivities: [
    {
      activityType: "share",
      points: 12,
      description: "Shared a camping tent",
      createdAt: "2025-06-15T12:00:00.000Z",
    },
    {
      activityType: "late_return",
      points: -7,
      description: "Returned a borrowed drill late",
      createdAt: "2025-05-03T12:00:00.000Z",
    },
    {
      activityType: "profile_update",
      points: 0,
      description: "Updated your profile",
      createdAt: "2025-04-01T12:00:00.000Z",
    },
  ],
};

beforeEach(() => {
  mocks.navigate.mockReset();
  mocks.useQuery.mockImplementation(({ queryKey }: { queryKey: string[] }) => {
    if (queryKey[0].includes("/reputation")) {
      return { data: populatedReputation, isLoading: false };
    }
    if (queryKey[0] === "/user-stats") {
      return { data: undefined, isLoading: false };
    }
    return { data: [], isLoading: false };
  });
});

afterEach(() => {
  cleanup();
});

describe("web score history navigation", () => {
  it("links both responsive Trust Score cards to the dedicated Score History route", () => {
    render(<AchievementsPage />);

    const trustScoreCards = screen.getAllByRole("link", { name: "View score history" });

    expect(trustScoreCards).toHaveLength(2);
    expect(trustScoreCards.map((card) => card.getAttribute("href"))).toEqual([
      "/score-history",
      "/score-history",
    ]);
  });

  it("renders descriptions, dates, positive and negative point labels, and excludes zero-point activity", () => {
    render(<ScoreHistoryPage />);

    expect(screen.getByText("Shared a camping tent")).toBeInTheDocument();
    expect(screen.getByText("Returned a borrowed drill late")).toBeInTheDocument();
    expect(screen.getByText("Jun 15, 2025")).toBeInTheDocument();
    expect(screen.getByText("May 3, 2025")).toBeInTheDocument();
    expect(screen.getByText("+12")).toBeInTheDocument();
    expect(screen.getByText("−7")).toBeInTheDocument();
    expect(screen.queryByText("Updated your profile")).not.toBeInTheDocument();
  });

  it.each([
    ["America/Los_Angeles", "2025-06-15T00:30:00.000Z", "Jun 15, 2025"],
    ["Pacific/Auckland", "2025-06-14T23:30:00.000Z", "Jun 14, 2025"],
  ] as [string, string, string][])(
    "keeps the UTC calendar date at a date boundary in %s",
    (timeZone: string, createdAt: string, expectedDate: string) => {
    const originalTimeZone = process.env.TZ;
    process.env.TZ = timeZone;

    try {
      mocks.useQuery.mockReturnValue({
        data: {
          ...populatedReputation,
          recentActivities: [{ ...populatedReputation.recentActivities[0], createdAt }],
        },
        isLoading: false,
      });

      render(<ScoreHistoryPage />);

      expect(screen.getByText(expectedDate)).toBeInTheDocument();
    } finally {
      if (originalTimeZone === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = originalTimeZone;
      }
    }
    },
  );

  it("shows an en dash instead of a misleading date for invalid or missing timestamps", () => {
    mocks.useQuery.mockReturnValue({
      data: {
        ...populatedReputation,
        recentActivities: [
          { ...populatedReputation.recentActivities[0], createdAt: "not-a-date" },
          { ...populatedReputation.recentActivities[1], createdAt: undefined },
        ],
      },
      isLoading: false,
    });

    render(<ScoreHistoryPage />);

    expect(screen.getAllByText("–")).toHaveLength(2);
    expect(screen.queryByText("Invalid Date")).not.toBeInTheDocument();
    expect(screen.queryByText("Jan 1, 1970")).not.toBeInTheDocument();
  });

  it("returns to Achievements from the history back control", () => {
    render(<ScoreHistoryPage />);

    fireEvent.click(screen.getByRole("button", { name: "Back to Achievements" }));

    expect(mocks.navigate).toHaveBeenCalledWith("/achievements");
  });

  it("shows the empty state when there are no non-zero score changes", () => {
    mocks.useQuery.mockReturnValue({
      data: { ...populatedReputation, recentActivities: [] },
      isLoading: false,
    });

    render(<ScoreHistoryPage />);

    expect(screen.getByText("No score changes yet")).toBeInTheDocument();
    expect(
      screen.getByText("Complete your first share to start building history."),
    ).toBeInTheDocument();
  });
});