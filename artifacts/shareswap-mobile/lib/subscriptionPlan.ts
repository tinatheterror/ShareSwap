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

export interface SheetCopy {
  title: string;
  /** e.g. "Upgrade to Pro: CA$9.99/month, charged to Visa •••• 4242" */
  headline: string;
  detail: string | null;
  confirmLabel: string;
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
  const title = !moving ? `Subscribe to ${name}` : upgrading ? `Upgrade to ${name}` : `Switch to ${name}`;
  const price = cad(preview?.priceCents ?? MONTHLY_CENTS[target]);
  const label = cardLabel(card);
  const headline = `${title}: ${price}/month${label ? `, charged to ${label}` : ""}`;

  let detail: string | null = null;
  if (moving && !upgrading) {
    const when = preview?.effectiveAt ? formatDate(preview.effectiveAt) : "the end of your current billing period";
    detail = `Takes effect on ${when}, when your current period ends. Nothing is charged or refunded now, and you keep your current plan until then.`;
  } else if (upgrading) {
    detail =
      preview?.amountDueTodayCents != null
        ? `Due today: ${cad(preview.amountDueTodayCents)}, prorated for the rest of this billing period. Then ${price}/month.`
        : "Your first charge is prorated for the rest of this billing period.";
  } else if (preview?.amountDueTodayCents != null) {
    detail = `Due today: ${cad(preview.amountDueTodayCents)}.`;
  }

  const confirmLabel = moving && !upgrading ? `Switch to ${name} at period end` : upgrading && preview?.amountDueTodayCents != null ? `Pay ${cad(preview.amountDueTodayCents)} and upgrade` : `Confirm ${name}`;
  return { title, headline, detail, confirmLabel };
}
