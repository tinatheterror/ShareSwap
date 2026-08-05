import {
  iname,
  iphotoRaw,
  coinsCount,
  weeklyPrice,
  getActionBtns,
  isGiftItem,
  type ItemLike,
} from "../itemUtils";

// ---------------------------------------------------------------------------
// iname — title resolution
// ---------------------------------------------------------------------------
describe("iname", () => {
  it("returns name when present", () => {
    expect(iname({ name: "Camping Tent" })).toBe("Camping Tent");
  });

  it("falls back to title when name is absent", () => {
    expect(iname({ title: "Old Road Bike" })).toBe("Old Road Bike");
  });

  it("returns 'Untitled' when both name and title are missing", () => {
    expect(iname({})).toBe("Untitled");
  });

  it("returns 'Untitled' when name is empty string and title is undefined", () => {
    expect(iname({ name: "" })).toBe("Untitled");
  });
});

// ---------------------------------------------------------------------------
// iphotoRaw — primary photo URL resolution
// ---------------------------------------------------------------------------
describe("iphotoRaw", () => {
  it("returns first photo from photos array when present", () => {
    expect(iphotoRaw({ photos: ["photo-abc.jpg", "photo-def.jpg"] })).toBe("photo-abc.jpg");
  });

  it("falls back to imageUrl when photos is absent", () => {
    expect(iphotoRaw({ imageUrl: "legacy.jpg" })).toBe("legacy.jpg");
  });

  it("falls back to imageUrl when photos is an empty array", () => {
    expect(iphotoRaw({ photos: [], imageUrl: "fallback.jpg" })).toBe("fallback.jpg");
  });

  it("returns null when both photos and imageUrl are absent", () => {
    expect(iphotoRaw({})).toBe(undefined);
  });

  it("returns null when photos is null", () => {
    expect(iphotoRaw({ photos: null })).toBe(undefined);
  });
});

// ---------------------------------------------------------------------------
// coinsCount — ShareCoin amount normalization
// ---------------------------------------------------------------------------
describe("coinsCount", () => {
  it("returns shareCoinPrice when set", () => {
    expect(coinsCount({ shareCoinPrice: 5 })).toBe(5);
  });

  it("falls back to shareCoinsReward when shareCoinPrice is absent", () => {
    expect(coinsCount({ shareCoinsReward: 3 })).toBe(3);
  });

  it("returns 0 when both are absent", () => {
    expect(coinsCount({})).toBe(0);
  });

  it("returns 0 when both are null", () => {
    expect(coinsCount({ shareCoinPrice: null, shareCoinsReward: null })).toBe(0);
  });

  it("rounds fractional values", () => {
    expect(coinsCount({ shareCoinPrice: 2.7 })).toBe(3);
  });

  it("handles string-typed numbers from API responses", () => {
    // API may return numeric fields as strings
    expect(coinsCount({ shareCoinPrice: "4" as unknown as number })).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// weeklyPrice — dollar price string formatting
// ---------------------------------------------------------------------------
describe("weeklyPrice", () => {
  it("formats dollarsPrice correctly", () => {
    expect(weeklyPrice({ dollarsPrice: 14 })).toBe("$14/wk");
  });

  it("formats pricePerDay by multiplying by 7", () => {
    expect(weeklyPrice({ pricePerDay: 2 })).toBe("$14/wk");
  });

  it("prefers dollarsPrice over pricePerDay", () => {
    expect(weeklyPrice({ dollarsPrice: 20, pricePerDay: 1 })).toBe("$20/wk");
  });

  it("returns null when both are absent", () => {
    expect(weeklyPrice({})).toBeNull();
  });

  it("returns null when both are null", () => {
    expect(weeklyPrice({ dollarsPrice: null, pricePerDay: null })).toBeNull();
  });

  it("returns null when both are zero", () => {
    expect(weeklyPrice({ dollarsPrice: 0, pricePerDay: 0 })).toBeNull();
  });

  it("handles string-typed price from API", () => {
    expect(weeklyPrice({ dollarsPrice: "10" as unknown as number })).toBe("$10/wk");
  });
});

// ---------------------------------------------------------------------------
// getActionBtns — action button derivation
// ---------------------------------------------------------------------------
const PRIMARY = "#0DCEA1";

describe("getActionBtns", () => {
  it("returns Borrow button for isLendable item", () => {
    const btns = getActionBtns({ isLendable: true }, PRIMARY);
    expect(btns).toHaveLength(1);
    expect(btns[0].label).toBe("Borrow It");
  });

  it("returns Rent button for isRentable item", () => {
    const btns = getActionBtns({ isRentable: true }, PRIMARY);
    expect(btns).toHaveLength(1);
    expect(btns[0].label).toBe("Rent It");
  });

  it("returns Swap button for isSwappable item", () => {
    const btns = getActionBtns({ isSwappable: true }, PRIMARY);
    expect(btns).toHaveLength(1);
    expect(btns[0].label).toBe("Swap It");
  });

  it("returns Claim Gift button for isGift item", () => {
    const btns = getActionBtns({ isGift: true }, PRIMARY);
    expect(btns).toHaveLength(1);
    expect(btns[0].label).toBe("Claim Gift");
  });

  it("returns multiple buttons when multiple flags are set", () => {
    const btns = getActionBtns({ isLendable: true, isRentable: true }, PRIMARY);
    expect(btns.length).toBeGreaterThan(1);
  });

  it("falls back to shareType 'rent'", () => {
    const btns = getActionBtns({ shareType: "rent" }, PRIMARY);
    expect(btns[0].label).toBe("Rent It");
  });

  it("falls back to shareType 'swap'", () => {
    const btns = getActionBtns({ shareType: "swap" }, PRIMARY);
    expect(btns[0].label).toBe("Swap It");
  });

  it("falls back to shareType 'gift'", () => {
    const btns = getActionBtns({ shareType: "gift" }, PRIMARY);
    expect(btns[0].label).toBe("Claim Gift");
  });

  it("defaults to Borrow when no flags or shareType set", () => {
    const btns = getActionBtns({}, PRIMARY);
    expect(btns[0].label).toBe("Borrow It");
  });

  it("always returns at least one button even for an empty item", () => {
    expect(getActionBtns({}, PRIMARY).length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// isGiftItem — gift detection
// ---------------------------------------------------------------------------
describe("isGiftItem", () => {
  it("returns true when isGift flag is set", () => {
    expect(isGiftItem({ isGift: true })).toBe(true);
  });

  it("returns true when shareType is 'gift'", () => {
    expect(isGiftItem({ shareType: "gift" })).toBe(true);
  });

  it("returns true when shareType is 'Gift' (case insensitive)", () => {
    expect(isGiftItem({ shareType: "Gift" })).toBe(true);
  });

  it("returns false for a standard borrowable item", () => {
    expect(isGiftItem({ isLendable: true })).toBe(false);
  });

  it("returns false for an empty item", () => {
    expect(isGiftItem({})).toBe(false);
  });
});
