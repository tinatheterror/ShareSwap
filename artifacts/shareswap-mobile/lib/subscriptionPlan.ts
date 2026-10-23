import { formatMoneyExact } from "./money";

export type Tier = "free" | "member" | "pro";

const RANK: Record<Tier, number> = { free: 0, member: 1, pro: 2 };
const MONTHLY_CENTS: Record<"member" | "pro", number> = { member: 499, pro: 999 };
const PLAN_NAMES: Record<Tier, string> = { free: "Free", member: "Member", pro: "Pro" };

/** What tapping a plan's button does. Only the portal buttons ("Manage billing") open Stripe's billing portal. */
export type PlanButtonAction = "current" | "free" | "confirm-sheet";

export function planButtonAction(currentTier: Tier, target: Tier): PlanButtonAction {
  if (target === currentTier) return "current";
  if (target === "free") return "free";
  return "confirm-sheet";
}

export interface PlanPreview {
  tier: "member" | "pro";
  priceCents: number;
  amountDueTodayCents: number | null;
  change: "new" | "upgrade" | "downgrade" | "same";
  effectiveAt?: string;
}

const BRAND_NAMES: Record<string, string> = { visa: "Visa", mastercard: "Mastercard", amex: "American Express", discover: "Discover", diners: "Diners Club", jcb: "JCB", unionpay: "UnionPay" };

export function cardLabel(card: { brand: string; last4: string } | null | undefined): string | null {
  if (!card) return null;
  return `${BRAND_NAMES[card.brand?.toLowerCase()] ?? card.brand} •••• ${card.last4}`;
}

const cad = (cents: number) => `CA${formatMoneyExact(cents / 100)}`;
const defaultDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "long", day: "numeric" });

export interface PendingPlanChange {
  tier: "member" | "pro";
  effectiveAt: string;
}

/** "Switching to Member on November 20": shown while a downgrade waits for the end of the paid period. */
export function pendingChangeLabel(pending: PendingPlanChange | null | undefined, formatDate: (iso: string) => string = defaultDate): string | null {
  if (!pending) return null;
  return `Switching to ${PLAN_NAMES[pending.tier]} on ${formatDate(pending.effectiveAt)}`;
}

/** "Keep Pro": the button that drops a pending downgrade, named after the plan the user is on. */
export function keepPlanLabel(currentTier: Tier): string {
  return currentTier === "free" ? "Keep my plan" : `Keep ${PLAN_NAMES[currentTier]}`;
}

export interface SheetCopy {
  title: string;
  /** e.g. "Upgrade to Pro: CA$9.99/month, charged to Visa •••• 4242" */
  headline: string;
  detail: string | null;
  confirmLabel: string;
  /** Whether the sheet names the card: not for a downgrade, where nothing is charged now. */
  showCard: boolean;
}

export function sheetCopy(opts: {
  currentTier: Tier;
  target: "member" | "pro";
  card: { brand: string; last4: string } | null;
  preview?: PlanPreview | null;
  formatDate?: (iso: string) => string;
}): SheetCopy {
  const { currentTier, target, card, preview } = opts;
  const formatDate = opts.formatDate ?? defaultDate;
  const name = PLAN_NAMES[target];
  const moving = currentTier !== "free" && currentTier !== target;
  const upgrading = moving && RANK[target] > RANK[currentTier];
  const price = cad(preview?.priceCents ?? MONTHLY_CENTS[target]);

  // A downgrade waits for the end of the paid period: nothing is charged now, so no card is named.
  if (moving && !upgrading) {
    const title = preview?.effectiveAt ? `Switch to ${name} on ${formatDate(preview.effectiveAt)}` : `Switch to ${name}`;
    return {
      title,
      headline: `${title}: ${price}/month after that`,
      detail: preview?.effectiveAt
        ? "Nothing is charged or refunded now, and you keep your current plan until then."
        : "Takes effect when your current billing period ends. Nothing is charged or refunded now.",
      confirmLabel: `Switch to ${name} at period end`,
      showCard: false,
    };
  }

  const title = upgrading ? `Upgrade to ${name}` : `Subscribe to ${name}`;
  const label = cardLabel(card);
  const headline = `${title}: ${price}/month${label ? `, charged to ${label}` : ""}`;
  let detail: string | null = null;
  if (upgrading) {
    detail =
      preview?.amountDueTodayCents != null
        ? `Due today: ${cad(preview.amountDueTodayCents)}, prorated for the rest of this billing period. Then ${price}/month.`
        : "Your first charge is prorated for the rest of this billing period.";
  } else if (preview?.amountDueTodayCents != null) {
    detail = `Due today: ${cad(preview.amountDueTodayCents)}.`;
  }
  const confirmLabel = upgrading && preview?.amountDueTodayCents != null ? `Pay ${cad(preview.amountDueTodayCents)} and upgrade` : `Confirm ${name}`;
  return { title, headline, detail, confirmLabel, showCard: true };
}

/**
 * The billing date row: a paid plan shows when it next renews (Stripe's current period end); a free plan shows
 * when its borrow count resets. A paid plan with no period end shows nothing rather than the borrow-reset date,
 * which is not a billing date.
 */
export function billingRow(opts: {
  hasActivePaidSub: boolean;
  currentPeriodEnd?: string | null;
  monthlyBorrowResetAt?: string | null;
  formatDate?: (iso: string) => string;
}): { label: string; date: string } | null {
  const formatDate = opts.formatDate ?? defaultDate;
  if (opts.hasActivePaidSub) return opts.currentPeriodEnd ? { label: "Next billing", date: formatDate(opts.currentPeriodEnd) } : null;
  return opts.monthlyBorrowResetAt ? { label: "Usage resets", date: formatDate(opts.monthlyBorrowResetAt) } : null;
}
