import {
  blockerAction,
  blockingRequestHref,
  blockingRequestLabel,
  WHAT_IS_DELETED,
  canRequestDeletion,
  daysLeft,
  isDeletionPending,
  pendingBannerText,
  walletCopy,
  type DeletionEligibility,
} from "../accountDeletion";

const wallet = (over: Partial<DeletionEligibility["wallet"]>): DeletionEligibility["wallet"] => ({
  available: "0.00",
  pending: "0.00",
  tier: "none",
  forfeitedOnDeletion: "0.00",
  requiresForfeitAcknowledgement: false,
  withdrawalOffer: null,
  ...over,
});

const eligibility = (over: Partial<DeletionEligibility> = {}): DeletionEligibility => ({
  eligible: true,
  blockers: [],
  autoResolve: { requests: 0 },
  wallet: wallet({}),
  willEnd: { subscription: false },
  ...over,
});

describe("walletCopy", () => {
  test("no balance: nothing to say and nothing to acknowledge", () => {
    expect(walletCopy(wallet({}))).toEqual({ lines: [], needsAcknowledgement: false, acknowledgement: null });
  });

  test("under $1 is forfeited and must be acknowledged", () => {
    const copy = walletCopy(wallet({ tier: "forfeit", available: "0.40", forfeitedOnDeletion: "0.40", requiresForfeitAcknowledgement: true }));
    expect(copy.needsAcknowledgement).toBe(true);
    expect(copy.lines[0]).toContain("$0.40");
    expect(copy.acknowledgement).toContain("$0.40");
  });

  test("$1 to $10 offers a withdrawal with the minimum waived, and still asks for the acknowledgement", () => {
    const copy = walletCopy(wallet({
      tier: "offer_withdrawal", available: "5.00", forfeitedOnDeletion: "5.00",
      withdrawalOffer: { amount: "5.00", minimumWaived: true, canWithdraw: true },
    }));
    expect(copy.lines.join(" ")).toContain("minimum is waived");
    expect(copy.needsAcknowledgement).toBe(true);
  });

  test("without a payout method the offer says to set one up", () => {
    const copy = walletCopy(wallet({
      tier: "offer_withdrawal", available: "5.00", forfeitedOnDeletion: "5.00",
      withdrawalOffer: { amount: "5.00", minimumWaived: true, canWithdraw: false },
    }));
    expect(copy.lines.join(" ")).toContain("payout method");
  });

  test("$10 or more must be withdrawn first and is not a forfeit to acknowledge", () => {
    const copy = walletCopy(wallet({ tier: "blocks", available: "25.00" }));
    expect(copy.needsAcknowledgement).toBe(false);
    expect(copy.lines[0]).toContain("Withdraw");
  });
});

describe("canRequestDeletion", () => {
  test("is false while anything blocks, whatever was ticked", () => {
    expect(canRequestDeletion(eligibility({ eligible: false, blockers: [{ code: "open_requests", message: "x" }] }), true)).toBe(false);
    expect(canRequestDeletion(undefined, true)).toBe(false);
  });

  test("needs the acknowledgement only when a balance would be forfeited", () => {
    expect(canRequestDeletion(eligibility(), false)).toBe(true);
    const forfeit = eligibility({ wallet: wallet({ tier: "forfeit", available: "0.40", forfeitedOnDeletion: "0.40", requiresForfeitAcknowledgement: true }) });
    expect(canRequestDeletion(forfeit, false)).toBe(false);
    expect(canRequestDeletion(forfeit, true)).toBe(true);
  });
});

describe("pending state", () => {
  const status = { accountStatus: "pending_deletion", deletionScheduledFor: "2026-11-13T12:00:00.000Z" };

  test("is pending only with the status and a date", () => {
    expect(isDeletionPending(status)).toBe(true);
    expect(isDeletionPending({ accountStatus: "active" })).toBe(false);
    expect(isDeletionPending({ accountStatus: "pending_deletion" })).toBe(false);
    expect(isDeletionPending(undefined)).toBe(false);
  });

  test("the banner names the day, and says tomorrow or today near the end", () => {
    expect(pendingBannerText(status.deletionScheduledFor, new Date("2026-10-30T12:00:00.000Z"))).toMatch(/^Your account will be deleted on .*2026/);
    expect(pendingBannerText(status.deletionScheduledFor, new Date("2026-11-12T12:00:00.000Z"))).toBe("Your account will be deleted tomorrow.");
    expect(pendingBannerText(status.deletionScheduledFor, new Date("2026-11-13T12:00:00.000Z"))).toBe("Your account will be deleted today.");
    expect(daysLeft(status.deletionScheduledFor, new Date("2026-12-01T00:00:00.000Z"))).toBe(0);
  });
});

describe("blockerAction", () => {
  test("points to the wallet for money and to the blocking-deletion inbox filter for open bookings, and nowhere for the rest", () => {
    expect(blockerAction("wallet_available")?.href).toBe("/wallet");
    expect(blockerAction("open_requests")?.href).toBe("/(tabs)/inbox?filter=blocking-deletion");
    expect(blockerAction("open_claims")).toBeNull();
  });
});

describe("blocking requests", () => {
  const request = { id: 7, itemName: "Camera", requestType: "RENT", status: "IN_PROGRESS", otherPartyId: 3 };

  test("are described by item, type and status, and link to the conversation", () => {
    expect(blockingRequestLabel(request)).toBe("Camera - Rental - In progress");
    expect(blockingRequestHref(request)).toBe("/chat/3?requestId=7");
    expect(blockingRequestHref({ ...request, otherPartyId: null })).toBeNull();
  });

  test("the deleted list is made of full sentences", () => {
    for (const line of WHAT_IS_DELETED) expect(line).toMatch(/\.$/);
  });
});
