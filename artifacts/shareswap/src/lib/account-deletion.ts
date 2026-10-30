// What the account-deletion page shows, derived from the server's answers. The server decides everything
// (eligibility, tiers, the schedule); this only words it. Same wording as the mobile app's lib/accountDeletion.ts.

export type BlockingRequest = { id: number; itemName: string; requestType: string; status: string; otherPartyId: number | null; statusLine: string };

const REQUEST_TYPE_LABELS: Record<string, string> = { BORROW: "Borrow", RENT: "Rental", SWAP: "Swap", GIFT: "Gift" };

/** "Camera - Rental - Return by Nov 3": which request is in the way and where it stands, as a person reads it. */
export function blockingRequestLabel(r: BlockingRequest): string {
  const type = REQUEST_TYPE_LABELS[r.requestType] ?? r.requestType.charAt(0) + r.requestType.slice(1).toLowerCase();
  return `${r.itemName} - ${type} - ${r.statusLine}`;
}

/** Opens the request's conversation in the inbox, where its actions are. */
export function openRequestConversation(requestId: number): void {
  window.dispatchEvent(new CustomEvent("open-chat-request", { detail: { requestId } }));
}

export type WalletTier = "none" | "forfeit" | "offer_withdrawal" | "blocks";

export type DeletionBlocker = { code: string; message: string; count?: number; amount?: string; requests?: BlockingRequest[] };

export type DeletionEligibility = {
  eligible: boolean;
  blockers: DeletionBlocker[];
  autoResolve: { requests: number };
  wallet: {
    available: string;
    pending: string;
    tier: WalletTier;
    forfeitedOnDeletion: string;
    requiresForfeitAcknowledgement: boolean;
    withdrawalOffer: { amount: string; minimumWaived: true; canWithdraw: boolean } | null;
  };
  willEnd: { subscription: boolean };
};

export type AccountStatus = {
  accountStatus?: string;
  deletionRequestedAt?: string | null;
  /** Set while a deletion is requested: when the account will be deleted. */
  deletionScheduledFor?: string | null;
};

export const GRACE_DAYS = 14;

export const isDeletionPending = (status: AccountStatus | undefined): status is AccountStatus & { deletionScheduledFor: string } =>
  status?.accountStatus === "pending_deletion" && !!status.deletionScheduledFor;

/** "November 13, 2026": the deletion date as the person's calendar shows it. */
export function deletionDateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { dateStyle: "long" });
}

export function daysLeft(iso: string, now: Date = new Date()): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now.getTime()) / 86_400_000));
}

export function pendingBannerText(iso: string, now: Date = new Date()): string {
  const days = daysLeft(iso, now);
  const when = days === 0 ? "today" : days === 1 ? "tomorrow" : `on ${deletionDateLabel(iso)}`;
  return `Your account will be deleted ${when}.`;
}

/** Where a blocker can be dealt with in the app, when it can. */
export function blockerAction(code: string): { label: string; href: string } | null {
  switch (code) {
    case "wallet_available":
    case "payout_unsettled":
      return { label: "Open your balance", href: "/my-balance" };
    default:
      return null;
  }
}

export type WalletCopy = { lines: string[]; needsAcknowledgement: boolean; acknowledgement: string | null };

/** The wallet part of the review step. Tiers: none, forfeit (under $1), offer_withdrawal ($1 up to $10), blocks ($10 or more). */
export function walletCopy(wallet: DeletionEligibility["wallet"]): WalletCopy {
  switch (wallet.tier) {
    case "none":
      return { lines: [], needsAcknowledgement: false, acknowledgement: null };
    case "forfeit":
      return {
        lines: [`Your wallet balance is $${wallet.available}. It is too small to withdraw, so it will be forfeited when your account is deleted.`],
        needsAcknowledgement: true,
        acknowledgement: `I understand that my balance of $${wallet.forfeitedOnDeletion} will be forfeited.`,
      };
    case "offer_withdrawal":
      return {
        lines: [
          `Your wallet balance is $${wallet.available}. After you request deletion you can withdraw all of it; the $10 minimum is waived.`,
          wallet.withdrawalOffer && !wallet.withdrawalOffer.canWithdraw ? "Set up a payout method in your wallet first." : "",
          "Whatever is left when your account is deleted is forfeited.",
        ].filter(Boolean),
        needsAcknowledgement: true,
        acknowledgement: `I understand that any of my $${wallet.forfeitedOnDeletion} that I don't withdraw will be forfeited.`,
      };
    case "blocks":
      return { lines: [`Your wallet holds $${wallet.available}. Withdraw it from your balance before deleting your account.`], needsAcknowledgement: false, acknowledgement: null };
  }
}

/** The request button is live only when nothing blocks it and any forfeit has been acknowledged. */
export function canRequestDeletion(eligibility: DeletionEligibility | undefined, forfeitAcknowledged: boolean): boolean {
  if (!eligibility?.eligible) return false;
  return walletCopy(eligibility.wallet).needsAcknowledgement ? forfeitAcknowledged : true;
}

export const DELETION_INTRO = `Your account is scheduled for deletion in ${GRACE_DAYS} days. You can cancel any time before that.`;

export const DELETED_HEADING = "When your account is deleted:";

export const WHAT_IS_DELETED = [
  "Your profile, photos, listings, wishlists and saved cards are deleted.",
  "Your messages and the ShareCoins in your account are deleted.",
  "Reviews about you are deleted. Reviews you wrote stay, shown as 'Former member'.",
];

export const WHAT_IS_KEPT =
  "Records of payments, payouts, deposits and disputes are kept for the period the law requires, without your name or contact details.";
