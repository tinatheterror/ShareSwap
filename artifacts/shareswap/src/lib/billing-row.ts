/**
 * The billing date row: a paid plan shows when it next renews (Stripe's current period end); a free plan shows
 * when its borrow count resets. A paid plan with no period end shows nothing rather than the borrow-reset date,
 * which is not a billing date.
 */
const defaultDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "long", day: "numeric" });

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
