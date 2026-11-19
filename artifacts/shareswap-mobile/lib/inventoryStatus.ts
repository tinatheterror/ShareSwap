import { safeDate } from "./dateUtils";

// How an item shows in My Items (mirrors the web app). A swapped or gifted item is always "Swapped"/"Gifted" and never offers a relist.

export type StatusKey = "available" | "unavailable" | "lent_out" | "rented_out" | "gifted" | "swapped";
export type FilterGroup = "all" | StatusKey;

export interface InventoryStatus {
  status: StatusKey;
  label: string;
  canDelete: boolean;
  deleteLabel: string;
  isDisputed?: boolean;
}

export interface MyItem {
  id: number;
  name: string;
  description?: string | null;
  photos: string[];
  isAvailable?: boolean;
  isLendable?: boolean;
  isRentable?: boolean;
  isSwappable?: boolean;
  isGift?: boolean;
  isSwapped?: boolean;
  isGifted?: boolean;
  condition?: string | null;
  conditionRating?: number | null;
  tier?: number | null;
  listingExpiresAt?: string | null;
  activeRequest?: {
    status: string;
    requestType: string;
  } | null;
}

// ─── Status logic (mirrors web app exactly) ────────────────────────────────────

export const ACTIVE_STATUSES = ["IN_PROGRESS", "HANDOFF_CONFIRMED", "DEPOSIT_CONFIRMED", "AWAITING_HANDOFF_CONFIRM"];

export function isListingExpired(item: MyItem): boolean {
  return !!item.listingExpiresAt && safeDate(item.listingExpiresAt) <= new Date();
}

export function getInventoryStatus(item: MyItem): InventoryStatus {
  // Given away: the server says so outright (a later request can outrank the completed gift), and it is never relisted.
  if (item.isGifted) {
    return { status: "gifted", label: "Gifted", canDelete: true, deleteLabel: "Remove from history" };
  }
  if (item.isSwapped) {
    return { status: "swapped", label: "Swapped", canDelete: true, deleteLabel: "Remove from history" };
  }
  const req = item.activeRequest;
  if (req) {
    const s = req.status;
    const t = req.requestType;
    if (s === "HANDOFF_DISPUTED" || s === "DISPUTED") {
      if (t === "RENT") return { status: "rented_out", label: "Rented Out", canDelete: false, deleteLabel: "", isDisputed: true };
      return { status: "lent_out", label: "Lent Out", canDelete: false, deleteLabel: "", isDisputed: true };
    }
    if (ACTIVE_STATUSES.includes(s)) {
      if (t === "RENT") return { status: "rented_out", label: "Rented Out", canDelete: false, deleteLabel: "" };
      return { status: "lent_out", label: "Lent Out", canDelete: false, deleteLabel: "" };
    }
    if (s === "ACCEPTED" || s === "PENDING") {
      return { status: "available", label: "Available", canDelete: false, deleteLabel: "" };
    }
    if (s === "COMPLETED" || s === "COMPLETED_EARLY") {
      if (t === "GIFT") return { status: "gifted", label: "Gifted", canDelete: true, deleteLabel: "Remove from history" };
      // A completed swap is not decided here: "Swapped" comes only from the item's own isSwapped flag (checked first).
    }
  }
  if (item.isAvailable && !isListingExpired(item)) {
    return { status: "available", label: "Available", canDelete: true, deleteLabel: "Remove item" };
  }
  return { status: "unavailable", label: "Unavailable", canDelete: true, deleteLabel: "Remove item" };
}
