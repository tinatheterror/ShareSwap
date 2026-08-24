import React from "react";
import { act } from "react";
import renderer from "react-test-renderer";
import { useQuery } from "@tanstack/react-query";
import AchievementsScreen from "@/app/(tabs)/achievements";
import ScoreHistoryScreen from "@/app/score-history";

const mockRouter = {
  push: jest.fn(),
  back: jest.fn(),
};

let mockReputationData: {
  reputationScore: number;
  reputationLevel: string;
  recentActivities: Array<{
    activityType: string;
    points: number;
    description: string;
    createdAt: string;
  }>;
} = {
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

jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({}),
}));

jest.mock("@tanstack/react-query", () => ({
  useQuery: jest.fn(),
}));

jest.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    primary: "#0DCEA1",
    primaryForeground: "#002319",
    foreground: "#0c0a09",
    mutedForeground: "#78716c",
    card: "#ffffff",
    muted: "#f5f5f4",
    border: "#e7e5e4",
    accent: "#f5f5f4",
    background: "#F3F4F6",
    success: "#16a34a",
    destructive: "#dc2626",
    radius: 14,
  }),
}));

jest.mock("@/lib/api", () => ({
  apiGet: jest.fn(),
}));

jest.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    user: {
      id: 7,
      username: "sam",
      email: "sam@example.com",
      trustScore: 142,
      trustLevel: "Neighbour",
      isVerified: true,
    },
  }),
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("@expo/vector-icons", () => {
  const { View } = require("react-native");
  const mockReact = require("react");
  return {
    Feather: (props: object) => mockReact.createElement(View, props),
  };
});

const mockUseQuery = useQuery as jest.Mock;

function renderScreen(element: React.ReactElement): renderer.ReactTestRenderer {
  let instance!: renderer.ReactTestRenderer;
  act(() => {
    instance = renderer.create(element);
  });
  return instance;
}

function renderedText(instance: renderer.ReactTestRenderer): string {
  const root = instance.toJSON();
  type RenderedNode = renderer.ReactTestRendererJSON | RenderedNode[] | string | number | null | undefined;
  const collect = (node: RenderedNode): string => {
    if (node == null) return "";
    if (typeof node === "string" || typeof node === "number") return String(node);
    if (Array.isArray(node)) return node.map(collect).join("");
    if (node.type === "Text") return collect(node.children);
    return collect(node.children);
  };
  return collect(root);
}

beforeEach(() => {
  mockReputationData = {
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
  mockRouter.push.mockReset();
  mockRouter.back.mockReset();
  mockUseQuery.mockImplementation(({ queryKey }: { queryKey: string[] }) => {
    if (queryKey[0].includes("/reputation")) {
      return { data: mockReputationData, isLoading: false };
    }
    if (queryKey[0] === "/api/achievements") {
      return { data: { score: 142, level: "Neighbour" }, isLoading: false };
    }
    return { data: undefined, isLoading: false };
  });
});

describe("native score history navigation", () => {
  it("opens Score History from the Trust Score card", () => {
    const instance = renderScreen(<AchievementsScreen />);
    const trustScoreCard = instance.root.find(
      (node) => node.props.accessibilityLabel === "View score history",
    );

    act(() => {
      trustScoreCard.props.onPress();
    });

    expect(mockRouter.push).toHaveBeenCalledWith("/score-history");
  });

  it("renders descriptions, dates, positive and negative point labels, and excludes zero-point activity", () => {
    const instance = renderScreen(<ScoreHistoryScreen />);
    const text = renderedText(instance);

    expect(text).toContain("Shared a camping tent");
    expect(text).toContain("Returned a borrowed drill late");
    expect(text).toContain("Jun 15, 2025");
    expect(text).toContain("May 3, 2025");
    expect(text).toContain("+12");
    expect(text).toContain("−7");
    expect(text).not.toContain("Updated your profile");
  });

  it("returns to Achievements from the history back control", () => {
    const instance = renderScreen(<ScoreHistoryScreen />);
    const backButton = instance.root.find(
      (node) => node.props.accessibilityLabel === "Back to achievements",
    );

    act(() => {
      backButton.props.onPress();
    });

    expect(mockRouter.back).toHaveBeenCalledTimes(1);
  });

  it("shows the empty state when there are no non-zero score changes", () => {
    mockReputationData = { ...mockReputationData, recentActivities: [] };

    const instance = renderScreen(<ScoreHistoryScreen />);
    const text = renderedText(instance);

    expect(text).toContain("No score changes yet");
    expect(text).toContain("Complete your first share to start building history.");
  });
});