import { and, eq } from "drizzle-orm";
import type Stripe from "stripe";
import { db, itemRequests, items, users, verifications } from "@workspace/db";
import { hashPassword, generateUserCode } from "./auth";
import { attachedCard, cardFieldsOf, type CardFields } from "./card-sync";
import { TERMS_VERSION } from "./legal-config";
import { tierOfSubscription } from "./subscription-upgrade";

/**
 * The App Review demo account (scripts/seed-reviewer-demo.ts runs it by hand, dry run first): already ID-verified, on the Member plan,
 * with a card on file and one completed transaction, so a reviewer reaches every screen without paying or verifying anything.
 *
 * Why it needs real Stripe objects: the app re-checks the stored card and plan against Stripe (card-sync.ts, subscription-upgrade.ts).
 * A card whose customer Stripe does not know is cleared the first time Payment Methods opens, and a stored Member plan with no live
 * Member subscription on the customer is corrected back to Free the first time the Subscription screen opens. So the script is given
 * the Stripe ids (made by hand in the Stripe dashboard, see docs/app-review-notes.md), checks them read-only in Stripe, and copies the
 * card details and subscription status from Stripe rather than inventing them. It creates nothing in Stripe.
 *
 * Verification: a "verifications" row with status "approved" and id_number DEMO_ACCOUNT, and NO Persona inquiry id, so persona:reset-sandbox
 * (which only touches approvals that carry an inquiry id) never resets it. No ID was checked, and the notes to Apple say it is a demo account.
 */

export const DEMO_ID_MARKER = "DEMO_ACCOUNT";
export const DEMO_REGION = "CA-ON";
export const DEMO_LENDER_SUFFIX = "-lender";
export const DEMO_ITEM_NAME = "Demo camping tent (2-person)";

export type StripeLinks = { customerId: string; paymentMethodId: string; subscriptionId: string };
export type VerifiedStripe = { card: CardFields; subscriptionStatus: string };
type DemoStripe = Pick<Stripe, "customers" | "paymentMethods" | "subscriptions">;

/** Reads the three Stripe objects and returns what to copy into the database, or every reason it cannot be used. */
export async function verifyStripeLinks(stripe: DemoStripe, links: Partial<StripeLinks>): Promise<{ ok: true; value: VerifiedStripe } | { ok: false; problems: string[] }> {
  const problems: string[] = [];
  const { customerId, paymentMethodId, subscriptionId } = links;
  if (!customerId?.startsWith("cus_")) problems.push("--stripe-customer=cus_... is required");
  if (!paymentMethodId?.startsWith("pm_")) problems.push("--stripe-payment-method=pm_... is required");
  if (!subscriptionId?.startsWith("sub_")) problems.push("--stripe-subscription=sub_... is required");
  if (problems.length) return { ok: false, problems };

  let card: CardFields | null = null;
  let subscriptionStatus = "";
  try {
    const customer = await stripe.customers.retrieve(customerId!);
    if ((customer as Stripe.DeletedCustomer).deleted) problems.push(`customer ${customerId} is deleted in Stripe`);
    else {
      const pm = await attachedCard(stripe, customerId!, paymentMethodId!);
      card = pm && cardFieldsOf(pm);
      if (!card) problems.push(`payment method ${paymentMethodId} does not exist, is not a card, or is not attached to ${customerId}`);
      else if (card.paymentMethodExpYear * 12 + card.paymentMethodExpMonth < new Date().getFullYear() * 12 + new Date().getMonth() + 1) problems.push(`the card ${paymentMethodId} is expired`);
      // The sync prefers the customer's default payment method when it differs from the stored one, so they must agree.
      const defaultRef = (customer as Stripe.Customer).invoice_settings?.default_payment_method;
      const defaultId = typeof defaultRef === "string" ? defaultRef : defaultRef?.id;
      if (card && defaultId && defaultId !== paymentMethodId) problems.push(`the customer's default payment method is ${defaultId}, not ${paymentMethodId}; the app would swap the stored card for it`);
    }
    const sub = await stripe.subscriptions.retrieve(subscriptionId!, { expand: ["items.data.price.product"] });
    const owner = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
    if (owner !== customerId) problems.push(`subscription ${subscriptionId} belongs to ${owner}, not ${customerId}`);
    if (!["active", "trialing", "past_due"].includes(sub.status)) problems.push(`subscription ${subscriptionId} is ${sub.status}, not active`);
    if (tierOfSubscription(sub) !== "member") problems.push(`subscription ${subscriptionId} is not on the Member plan (its product has no metadata tier=member)`);
    subscriptionStatus = sub.status;
  } catch (error) {
    problems.push(`Stripe lookup failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return problems.length || !card ? { ok: false, problems } : { ok: true, value: { card, subscriptionStatus } };
}

export type DemoPlan = {
  email: string;
  demoExists: boolean;
  lenderExists: boolean;
  hasApprovedVerification: boolean;
  hasCompletedRequest: boolean;
  setsPassword: boolean;
};

export const lenderUsernameFor = (email: string) => `${email.split("@")[0]}${DEMO_LENDER_SUFFIX}@example.com`;

export async function planDemoAccount(email: string, passwordGiven: boolean): Promise<DemoPlan> {
  const [demo] = await db.select({ id: users.id }).from(users).where(eq(users.username, email)).limit(1);
  const [lender] = await db.select({ id: users.id }).from(users).where(eq(users.username, lenderUsernameFor(email))).limit(1);
  const approved = demo ? (await db.select({ id: verifications.id }).from(verifications).where(and(eq(verifications.userId, demo.id), eq(verifications.status, "approved"))).limit(1)).length > 0 : false;
  const done = demo ? (await db.select({ id: itemRequests.id }).from(itemRequests).where(and(eq(itemRequests.requesterId, demo.id), eq(itemRequests.status, "COMPLETED"))).limit(1)).length > 0 : false;
  return { email, demoExists: !!demo, lenderExists: !!lender, hasApprovedVerification: approved, hasCompletedRequest: done, setsPassword: !demo || passwordGiven };
}

export function describeDemoPlan(plan: DemoPlan, stripe: { ok: true; value: VerifiedStripe } | { ok: false; problems: string[] }): string {
  const lines = [`Demo reviewer account: ${plan.email}`, ""];
  lines.push(plan.demoExists ? "- account exists: its managed fields are updated (password only if DEMO_PASSWORD is set)" : "- account is created (email verified, terms and age gate passed, location set, Verified badge)");
  lines.push(plan.hasApprovedVerification ? "- approved verification row: already there" : "- adds a verification row: approved, marker DEMO_ACCOUNT, no Persona inquiry id (persona:reset-sandbox will not touch it)");
  lines.push(plan.lenderExists ? "- demo lender (the other side of the transaction): already there" : `- creates the demo lender ${lenderUsernameFor(plan.email)} (cannot sign in; no password) with one listing`);
  lines.push(plan.hasCompletedRequest ? "- completed transaction: already there" : "- adds one COMPLETED borrow of the lender's listing");
  lines.push(stripe.ok
    ? `- Stripe checked read-only: card ${stripe.value.card.paymentMethodBrand} ending ${stripe.value.card.paymentMethodLast4} (exp ${stripe.value.card.paymentMethodExpMonth}/${stripe.value.card.paymentMethodExpYear}) and a ${stripe.value.subscriptionStatus} Member subscription are linked`
    : ["- Stripe NOT usable yet, apply is refused until this is fixed:", ...stripe.problems.map((p) => `    * ${p}`)].join("\n"));
  return lines.join("\n");
}

/** Writes everything in one transaction. Safe to run twice: existing rows are updated or left alone. */
export async function applyDemoAccount(input: { email: string; password?: string; links: StripeLinks; stripe: VerifiedStripe }) {
  const { email, links, stripe } = input;
  const now = new Date();
  return db.transaction(async (tx) => {
    const base = {
      emailVerified: true, email, displayName: "Demo Reviewer", fullName: "Demo Reviewer", authProvider: "local", accountStatus: "active",
      termsAcceptedAt: now, termsVersion: TERMS_VERSION, ageConfirmedAt: now, ageRegion: DEMO_REGION,
      isVerified: true, verifiedAt: now, hasSeenVerificationNudge: true, hasCompletedFirstBorrow: true,
      defaultCity: "Toronto", defaultPostalCode: "M5V 2T6", hasCompletedLocationSetup: true,
      subscriptionTier: "member", stripeCustomerId: links.customerId, stripeSubscriptionId: links.subscriptionId, stripeSubscriptionStatus: stripe.subscriptionStatus,
      stripePaymentMethodId: stripe.card.stripePaymentMethodId, paymentMethodLast4: stripe.card.paymentMethodLast4, paymentMethodBrand: stripe.card.paymentMethodBrand,
      paymentMethodExpMonth: stripe.card.paymentMethodExpMonth, paymentMethodExpYear: stripe.card.paymentMethodExpYear, paymentMethodAddedAt: now,
    };
    let [demo] = await tx.select().from(users).where(eq(users.username, email)).limit(1);
    if (demo) {
      await tx.update(users).set({ ...base, ...(input.password ? { password: await hashPassword(input.password) } : {}) }).where(eq(users.id, demo.id));
    } else {
      if (!input.password) throw new Error("DEMO_PASSWORD is required to create the account");
      const code = await generateUserCode("D");
      [demo] = await tx.insert(users).values({ ...base, username: email, password: await hashPassword(input.password), handle: code, referralCode: code }).returning();
    }

    const [approved] = await tx.select({ id: verifications.id }).from(verifications).where(and(eq(verifications.userId, demo.id), eq(verifications.status, "approved"))).limit(1);
    if (!approved) await tx.insert(verifications).values({ userId: demo.id, fullName: "Demo Reviewer", idNumber: DEMO_ID_MARKER, status: "approved" });

    const lenderName = lenderUsernameFor(email);
    let [lender] = await tx.select().from(users).where(eq(users.username, lenderName)).limit(1);
    if (!lender) {
      const code = await generateUserCode("L");
      [lender] = await tx.insert(users).values({
        username: lenderName, handle: code, referralCode: code, displayName: "Demo Lender", fullName: "Demo Lender", authProvider: "local", password: null,
        email: null, accountStatus: "active", termsAcceptedAt: now, termsVersion: TERMS_VERSION, ageConfirmedAt: now, ageRegion: DEMO_REGION,
        defaultCity: "Toronto", hasCompletedLocationSetup: true, hasCompletedFirstLend: true, hasCompletedFirstListing: true,
      }).returning();
    }
    let [item] = await tx.select().from(items).where(and(eq(items.ownerId, lender.id), eq(items.name, DEMO_ITEM_NAME))).limit(1);
    if (!item) {
      [item] = await tx.insert(items).values({
        ownerId: lender.id, name: DEMO_ITEM_NAME, description: "A clean two-person tent with poles and stakes, lent for weekend trips. (Demo listing for App Review.)",
        category: "Outdoors", condition: "Good", conditionRating: 4, photos: [], isLendable: true, isAvailable: true, shareCoinsReward: "0",
        replacementValue: 120, city: "Toronto", state: "ON", country: "CA",
      }).returning();
    }

    const [done] = await tx.select({ id: itemRequests.id }).from(itemRequests).where(and(eq(itemRequests.requesterId, demo.id), eq(itemRequests.itemId, item.id), eq(itemRequests.status, "COMPLETED"))).limit(1);
    let requestId = done?.id ?? null;
    if (!done) {
      const day = 24 * 60 * 60 * 1000;
      const start = new Date(now.getTime() - 14 * day), end = new Date(now.getTime() - 11 * day);
      [{ id: requestId }] = await tx.insert(itemRequests).values({
        itemId: item.id, requesterId: demo.id, requestType: "BORROW", status: "COMPLETED", message: "Hi, could I borrow the tent for the weekend?",
        startDate: start, endDate: end, negotiationStatus: "terms_accepted", termsAcceptedAt: start, acceptedAt: start, depositStatus: "released", depositReleasedAt: end,
        ownerConfirmedHandoff: true, ownerConfirmedHandoffAt: start, borrowerConfirmedHandoff: true, borrowerConfirmedHandoffAt: start, handoffConfirmedAt: start, actualHandoffAt: start,
        ownerConfirmedReturn: true, ownerConfirmedReturnAt: end, borrowerConfirmedReturn: true, borrowerConfirmedReturnAt: end, returnConfirmedAt: end, actualReturnAt: end, returnConditionOk: true,
      }).returning({ id: itemRequests.id });
    }
    return { demoUserId: demo.id, lenderUserId: lender.id, itemId: item.id, requestId };
  });
}
