/**
 * Component render tests for ItemCard.
 *
 * These tests confirm the card doesn't crash when API responses have
 * null, missing, or unexpected field values — including date-adjacent
 * fields like lastActivityTime and availability flags.
 */
import React from "react";
import { act } from "react";
import renderer from "react-test-renderer";
import { ItemCard, type Item } from "../ItemCard";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn() }),
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
    radius: 14,
  }),
}));

jest.mock("@/lib/api", () => ({
  photoUrl: (p: string | null | undefined) =>
    p ? `https://cdn.example.com/${p}` : undefined,
}));

jest.mock("@/lib/itemUtils", () => {
  const actual = jest.requireActual("@/lib/itemUtils");
  return actual;
});

jest.mock("@expo/vector-icons", () => {
  const { View } = require("react-native");
  const mockReact = require("react");
  return {
    Feather: (props: object) => mockReact.createElement(View, props),
    MaterialCommunityIcons: (props: object) => mockReact.createElement(View, props),
  };
});

jest.mock("lucide-react-native", () => {
  const { View } = require("react-native");
  const mockReact = require("react");
  return {
    HandHeart: (props: object) => mockReact.createElement(View, props),
    ArrowLeftRight: (props: object) => mockReact.createElement(View, props),
    Coins: (props: object) => mockReact.createElement(View, props),
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function render(item: Item): renderer.ReactTestRenderer {
  let instance!: renderer.ReactTestRenderer;
  act(() => {
    instance = renderer.create(<ItemCard item={item} />);
  });
  return instance;
}

function renderCompact(item: Item): renderer.ReactTestRenderer {
  let instance!: renderer.ReactTestRenderer;
  act(() => {
    instance = renderer.create(<ItemCard item={item} compact />);
  });
  return instance;
}

// Minimal valid item
const BASE_ITEM: Item = {
  id: 1,
  name: "Road Bike",
  isLendable: true,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ItemCard — basic render", () => {
  it("renders without crashing for a minimal item", () => {
    expect(() => render(BASE_ITEM)).not.toThrow();
  });

  it("renders without crashing in compact mode", () => {
    expect(() => renderCompact(BASE_ITEM)).not.toThrow();
  });

  it("renders the item name", () => {
    const tree = render(BASE_ITEM).toJSON();
    expect(JSON.stringify(tree)).toContain("Road Bike");
  });

  it("shows 'Untitled' when name and title are both absent", () => {
    const tree = render({ id: 2 }).toJSON();
    expect(JSON.stringify(tree)).toContain("Untitled");
  });
});

describe("ItemCard — null / missing field resilience", () => {
  it("renders without crashing when all optional fields are null", () => {
    const item: Item = {
      id: 3,
      name: null as unknown as string,
      title: null as unknown as string,
      description: undefined,
      photos: null,
      imageUrl: null,
      pricePerDay: null,
      dollarsPrice: null,
      shareCoinPrice: null,
      shareCoinsReward: null,
      isAvailable: null as unknown as boolean,
      conditionRating: null,
      category: undefined,
      location: undefined,
      city: null,
    };
    expect(() => render(item)).not.toThrow();
  });

  it("renders without crashing when owner is absent", () => {
    expect(() => render({ ...BASE_ITEM, owner: undefined })).not.toThrow();
  });

  it("renders without crashing when owner fields are partially null", () => {
    const item: Item = {
      ...BASE_ITEM,
      owner: {
        id: 99,
        username: "alice",
        displayName: null as unknown as string,
        avatarUrl: null,
        trustScore: undefined,
        isVerified: undefined,
      },
    };
    expect(() => render(item)).not.toThrow();
  });

  it("renders without crashing when photos is an empty array", () => {
    expect(() => render({ ...BASE_ITEM, photos: [] })).not.toThrow();
  });

  it("renders without crashing when isAvailable is false (Currently Out badge)", () => {
    expect(() => render({ ...BASE_ITEM, isAvailable: false })).not.toThrow();
  });
});

describe("ItemCard — pricing field edge cases", () => {
  it("renders without crashing when shareCoinPrice is 0", () => {
    expect(() => render({ ...BASE_ITEM, shareCoinPrice: 0 })).not.toThrow();
  });

  it("renders without crashing when dollarsPrice is a string '0'", () => {
    expect(() => render({ ...BASE_ITEM, dollarsPrice: "0" })).not.toThrow();
  });

  it("renders without crashing when dollarsPrice is a numeric string from API", () => {
    expect(() => render({ ...BASE_ITEM, dollarsPrice: "14" })).not.toThrow();
  });

  it("renders without crashing with both coin and dollar pricing", () => {
    expect(() =>
      render({ ...BASE_ITEM, shareCoinPrice: 5, dollarsPrice: 14 }),
    ).not.toThrow();
  });
});

describe("ItemCard — sharing flag variations", () => {
  it("renders a gift item without crashing", () => {
    expect(() =>
      render({ ...BASE_ITEM, isGift: true, isLendable: false }),
    ).not.toThrow();
  });

  it("renders a rentable item without crashing", () => {
    expect(() =>
      render({ ...BASE_ITEM, isLendable: false, isRentable: true }),
    ).not.toThrow();
  });

  it("renders a swappable item without crashing", () => {
    expect(() =>
      render({ ...BASE_ITEM, isLendable: false, isSwappable: true }),
    ).not.toThrow();
  });

  it("renders when shareType is 'gift' (string fallback)", () => {
    expect(() => render({ id: 10, shareType: "gift" })).not.toThrow();
  });

  it("renders when shareType is 'rent' (string fallback)", () => {
    expect(() => render({ id: 11, shareType: "rent" })).not.toThrow();
  });

  it("renders when no sharing flags are set at all", () => {
    expect(() => render({ id: 12 })).not.toThrow();
  });
});
