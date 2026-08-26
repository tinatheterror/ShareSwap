import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useQuery: vi.fn(),
  Icon: () => null,
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: mocks.useQuery,
}));

vi.mock("lucide-react", () => ({
  Star: mocks.Icon,
  Award: mocks.Icon,
  Clock: mocks.Icon,
}));

vi.mock("@/components/ui/card", () => ({
  Card: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
    <div {...props}>{children}</div>
  ),
  CardHeader: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
    <div {...props}>{children}</div>
  ),
  CardTitle: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
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

import { UserReputation } from "../user-reputation";

const baseReputation = {
  reputationScore: 142,
  reputationLevel: "Regular",
  recentActivities: [
    {
      activityType: "share",
      points: 12,
      description: "Shared a camping tent",
      createdAt: "2025-06-15T12:00:00.000Z",
    },
  ],
  reviews: [],
};

beforeEach(() => {
  mocks.useQuery.mockReturnValue({ data: baseReputation });
});

afterEach(() => {
  cleanup();
});

describe("UserReputation activity dates", () => {
  it("renders the activity date using its UTC calendar day", () => {
    render(<UserReputation userId={1} />);

    expect(screen.getByText("Jun 15, 2025")).toBeInTheDocument();
  });

  it.each([
    ["America/Los_Angeles", "2025-06-15T00:30:00.000Z", "Jun 15, 2025"],
    ["Pacific/Auckland", "2025-06-14T23:30:00.000Z", "Jun 14, 2025"],
  ] as [string, string, string][])(
    "keeps the UTC calendar date at a date boundary in %s",
    (timeZone, createdAt, expectedDate) => {
      const originalTimeZone = process.env.TZ;
      process.env.TZ = timeZone;

      try {
        mocks.useQuery.mockReturnValue({
          data: {
            ...baseReputation,
            recentActivities: [{ ...baseReputation.recentActivities[0], createdAt }],
          },
        });

        render(<UserReputation userId={1} />);

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
        ...baseReputation,
        recentActivities: [
          { ...baseReputation.recentActivities[0], createdAt: "not-a-date" },
          { ...baseReputation.recentActivities[0], createdAt: undefined },
        ],
      },
    });

    render(<UserReputation userId={1} />);

    expect(screen.getAllByText("–")).toHaveLength(2);
    expect(screen.queryByText("Invalid Date")).not.toBeInTheDocument();
    expect(screen.queryByText("Jan 1, 1970")).not.toBeInTheDocument();
  });
});
