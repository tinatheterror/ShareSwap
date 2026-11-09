/**
 * Component-level tests for InboxRow behaviour.
 *
 * InboxRow is the per-conversation row rendered in the inbox / activity feed.
 * It formats `lastActivityTime` via `formatTime` from dateUtils, applies
 * unread/needs-action styling, and handles nullable partner/item metadata.
 *
 * These tests confirm the row doesn't crash when the API sends null, missing,
 * or unexpected field values — particularly around date fields.
 */
import React from "react";
import { act } from "react";
import renderer from "react-test-renderer";

// ---------------------------------------------------------------------------
// Module mocks — declared before any component imports so jest.mock() hoisting
// applies correctly.
// ---------------------------------------------------------------------------

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    primary: "#0DCEA1",
    foreground: "#0c0a09",
    mutedForeground: "#78716c",
    card: "#ffffff",
    muted: "#f5f5f4",
    border: "#e7e5e4",
    accent: "#f5f5f4",
    background: "#F3F4F6",
    radius: 14,
  }),
}));

jest.mock("@/lib/api", () => ({
  apiGet: jest.fn(),
  apiRequest: jest.fn(),
  photoUrl: (p: string | null | undefined) =>
    p ? `https://cdn.example.com/${p}` : undefined,
}));

jest.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 1 } }),
}));

jest.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: undefined, isLoading: false, refetch: jest.fn() }),
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));

jest.mock("@/components/NotificationBell", () => {
  const { View } = require("react-native");
  const mockReact = require("react");
  return { NotificationBell: () => mockReact.createElement(View, null) };
});

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("@expo/vector-icons", () => {
  const { View } = require("react-native");
  const mockReact = require("react");
  return {
    Feather: (props: object) => mockReact.createElement(View, props),
    MaterialCommunityIcons: (props: object) => mockReact.createElement(View, props),
  };
});

// ---------------------------------------------------------------------------
// Import the real InboxRow and InboxItem from the production screen module.
// ---------------------------------------------------------------------------

import { InboxRow, InboxItem } from "@/app/(tabs)/inbox";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_ITEM: InboxItem = {
  requestId: 1,
  partnerId: 2,
  partnerUsername: "alice",
  partnerDisplayName: "Alice Smith",
  partnerPhoto: null,
  partnerIsVerified: false,
  partnerLastActiveAt: null,
  partnerActiveStatus: null,
  lastActivityTime: "2025-06-15T09:30:00.000Z",
  preview: "Hey, is the bike still available?",
  previewType: "message",
  previewSentByMe: false,
  unreadCount: 0,
  requestType: "borrow",
  requestStatus: "PENDING",
  requestNegotiationStatus: null,
  itemName: "Road Bike",
  itemId: 10,
  itemPhoto: null,
  iAmRequester: true,
  isArchived: false,
};

function renderRow(item: InboxItem): renderer.ReactTestRenderer {
  let instance!: renderer.ReactTestRenderer;
  act(() => {
    instance = renderer.create(<InboxRow item={item} onPress={jest.fn()} />);
  });
  return instance;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("InboxRow — basic render", () => {
  it("renders without crashing for a normal inbox item", () => {
    expect(() => renderRow(BASE_ITEM)).not.toThrow();
  });

  it("shows the partner name", () => {
    const tree = renderRow(BASE_ITEM).toJSON();
    expect(JSON.stringify(tree)).toContain("Alice Smith");
  });

  it("shows the item name", () => {
    const tree = renderRow(BASE_ITEM).toJSON();
    expect(JSON.stringify(tree)).toContain("Road Bike");
  });

  it("shows the formatted timestamp from lastActivityTime", () => {
    const tree = renderRow(BASE_ITEM).toJSON();
    // The formatted time should not be "–" for a valid past ISO timestamp
    expect(JSON.stringify(tree)).not.toContain('"–"');
  });
});

describe("InboxRow — date field resilience", () => {
  it("renders without crashing when lastActivityTime is a bare YYYY-MM-DD", () => {
    expect(() =>
      renderRow({ ...BASE_ITEM, lastActivityTime: "2025-06-15" }),
    ).not.toThrow();
  });

  it("renders without crashing when lastActivityTime is a full ISO timestamp", () => {
    expect(() =>
      renderRow({ ...BASE_ITEM, lastActivityTime: "2025-06-15T12:00:00.000Z" }),
    ).not.toThrow();
  });

  it("renders '–' instead of crashing for a malformed lastActivityTime", () => {
    const tree = renderRow({
      ...BASE_ITEM,
      lastActivityTime: "not-a-date",
    }).toJSON();
    expect(JSON.stringify(tree)).toContain("–");
  });

  it("renders '–' instead of crashing for an empty lastActivityTime", () => {
    const tree = renderRow({
      ...BASE_ITEM,
      lastActivityTime: "",
    }).toJSON();
    expect(JSON.stringify(tree)).toContain("–");
  });
});

describe("InboxRow — null / missing field resilience", () => {
  it("renders without crashing when partnerDisplayName is null (shows username)", () => {
    const item = { ...BASE_ITEM, partnerDisplayName: null };
    expect(() => renderRow(item)).not.toThrow();
    const tree = renderRow(item).toJSON();
    expect(JSON.stringify(tree)).toContain("alice");
  });

  it("renders without crashing when partnerPhoto is null (shows initials)", () => {
    expect(() =>
      renderRow({ ...BASE_ITEM, partnerPhoto: null }),
    ).not.toThrow();
  });

  it("renders without crashing when partnerPhoto is a valid URL", () => {
    expect(() =>
      renderRow({ ...BASE_ITEM, partnerPhoto: "avatar-abc.jpg" }),
    ).not.toThrow();
  });

  it("renders without crashing when itemPhoto is null", () => {
    expect(() => renderRow({ ...BASE_ITEM, itemPhoto: null })).not.toThrow();
  });

  it("renders without crashing when preview is empty string", () => {
    expect(() => renderRow({ ...BASE_ITEM, preview: "" })).not.toThrow();
  });

  it("renders without crashing when previewSentByMe is null", () => {
    expect(() =>
      renderRow({ ...BASE_ITEM, previewSentByMe: null }),
    ).not.toThrow();
  });

  it("renders without crashing when requestNegotiationStatus is null", () => {
    expect(() =>
      renderRow({ ...BASE_ITEM, requestNegotiationStatus: null }),
    ).not.toThrow();
  });
});

describe("InboxRow — unread / needs-action state", () => {
  it("renders unread badge when unreadCount > 0", () => {
    const tree = renderRow({ ...BASE_ITEM, unreadCount: 3 }).toJSON();
    expect(JSON.stringify(tree)).toContain("3");
  });

  it("renders action badge when item needs requester action", () => {
    const item: InboxItem = {
      ...BASE_ITEM,
      requestStatus: "PENDING",
      iAmRequester: false,
      unreadCount: 0,
    };
    const tree = renderRow(item).toJSON();
    expect(JSON.stringify(tree)).toContain("!");
  });

  it("renders without crashing when isArchived is true", () => {
    expect(() =>
      renderRow({ ...BASE_ITEM, isArchived: true }),
    ).not.toThrow();
  });

  it("renders 'You: ' prefix when previewSentByMe is true", () => {
    const item: InboxItem = {
      ...BASE_ITEM,
      previewType: "message",
      previewSentByMe: true,
      preview: "Sure!",
    };
    const tree = renderRow(item).toJSON();
    expect(JSON.stringify(tree)).toContain("You: Sure!");
  });
});
