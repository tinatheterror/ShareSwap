/**
 * Pure data-transformation helpers for item/loan cards.
 * Extracted from ItemCard so they can be unit-tested independently of React Native.
 */

export interface ItemLike {
  id?: number;
  name?: string;
  title?: string;
  shareType?: string;
  isLendable?: boolean;
  isRentable?: boolean;
  isSwappable?: boolean;
  isGift?: boolean;
  isAvailable?: boolean;
  pricePerDay?: number | null;
  dollarsPrice?: string | number | null;
  shareCoinPrice?: number | null;
  shareCoinsReward?: number | null;
  photos?: string[] | null;
  imageUrl?: string | null;
}

/** Resolve display title from the item, falling back to "Untitled". */
export function iname(item: ItemLike): string {
  return item.name || item.title || "Untitled";
}

/** Resolve the primary photo URL from the item (first of `photos`, then `imageUrl`). */
export function iphotoRaw(item: ItemLike): string | null | undefined {
  return item.photos && item.photos.length > 0 ? item.photos[0] : item.imageUrl;
}

/** Return the rounded ShareCoin count (falls back to 0). */
export function coinsCount(item: ItemLike): number {
  return Math.round(Number(item.shareCoinPrice || item.shareCoinsReward || 0));
}

/** Return a formatted weekly-price string like "$14/wk", or null if no price. */
export function weeklyPrice(item: ItemLike): string | null {
  if (item.dollarsPrice && Number(item.dollarsPrice) > 0)
    return `$${Number(item.dollarsPrice).toFixed(0)}/wk`;
  if (item.pricePerDay && Number(item.pricePerDay) > 0)
    return `$${(Number(item.pricePerDay) * 7).toFixed(0)}/wk`;
  return null;
}

export type ActionBtn = {
  label: string;
  icon: string;
  family: "feather" | "hand-heart" | "arrow-lr";
  bg: string;
};

/** Derive the action buttons to display on an item card. Always returns at least one. */
export function getActionBtns(item: ItemLike, primaryColor: string): ActionBtn[] {
  const btns: ActionBtn[] = [];
  if (item.isGift)      btns.push({ label: "Claim Gift", icon: "gift",         family: "feather",    bg: "#ec4899" });
  if (item.isLendable)  btns.push({ label: "Borrow It",  icon: "",             family: "hand-heart", bg: primaryColor });
  if (item.isRentable)  btns.push({ label: "Rent It",    icon: "dollar-sign",  family: "feather",    bg: primaryColor });
  if (item.isSwappable) btns.push({ label: "Swap It",    icon: "",             family: "arrow-lr",   bg: primaryColor });
  if (btns.length > 0) return btns;
  // Fallback to shareType
  const st = (item.shareType || "borrow").toLowerCase();
  if (st === "gift") return [{ label: "Claim Gift", icon: "gift",        family: "feather",    bg: "#ec4899" }];
  if (st === "rent") return [{ label: "Rent It",    icon: "dollar-sign", family: "feather",    bg: primaryColor }];
  if (st === "swap") return [{ label: "Swap It",    icon: "",            family: "arrow-lr",   bg: primaryColor }];
  return               [{ label: "Borrow It",   icon: "",            family: "hand-heart", bg: primaryColor }];
}

/** Return true when the item should be treated as a gift (free) listing. */
export function isGiftItem(item: ItemLike): boolean {
  return !!(item.isGift || (item.shareType || "").toLowerCase() === "gift");
}
