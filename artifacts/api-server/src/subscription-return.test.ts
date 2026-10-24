import assert from "node:assert/strict";
import { test } from "node:test";
import {
  confirmCheckoutSession,
  isAllowedAppLink,
  resolveReturnTarget,
  stripeReturnUrl,
  subscriptionReturnHandler,
  type ConfirmStore,
} from "./subscription-return.js";

const HOSTS = new Set(["shareswap.app", "www.shareswap.app", "dev.example.replit.dev"]);
const BASE = "https://shareswap.app";

test("allowlist accepts only the app scheme and our own https domains", () => {
  for (const ok of ["shareswap:///subscription?sub_success=true", "shareswap://subscription", "https://shareswap.app/profile", "https://dev.example.replit.dev/x"]) {
    assert.equal(isAllowedAppLink(ok, HOSTS), true, ok);
  }
  for (const bad of [
    "https://evil.com/x", "http://shareswap.app/x", "https://shareswap.app.evil.com/", "https://evil.com/?u=shareswap.app",
    "https://user:pw@shareswap.app/", "javascript:alert(1)", "data:text/html,hi", "exp://evil.com/--/x", "evilscheme://x", "//evil.com", "", null, 5,
  ]) {
    assert.equal(isAllowedAppLink(bad, HOSTS), false, String(bad));
  }
});

test("stripeReturnUrl routes app links through the https return route and keeps the session placeholder raw", () => {
  const app = "shareswap:///subscription?sub_success=true";
  const url = stripeReturnUrl({ clientUrl: app, result: "success", baseUrl: BASE, fallback: "FB", hosts: HOSTS });
  assert.ok(url.startsWith(`${BASE}/api/subscription/return?result=success&app=`));
  assert.ok(url.endsWith("&session_id={CHECKOUT_SESSION_ID}"));
  assert.equal(new URL(url).searchParams.get("app"), app);
  const cancel = stripeReturnUrl({ clientUrl: "shareswap:///subscription?sub_canceled=true", result: "canceled", baseUrl: BASE, fallback: "FB", hosts: HOSTS });
  assert.ok(!cancel.includes("session_id"));
});

test("stripeReturnUrl keeps own https links and falls back for anything else", () => {
  const args = { result: "success", baseUrl: BASE, fallback: "FB", hosts: HOSTS } as const;
  assert.equal(stripeReturnUrl({ ...args, clientUrl: "https://shareswap.app/profile" }), "https://shareswap.app/profile");
  for (const bad of ["https://evil.com/", "javascript:alert(1)", undefined, 7]) {
    assert.equal(stripeReturnUrl({ ...args, clientUrl: bad }), "FB");
  }
});

test("resolveReturnTarget redirects to the carried app link, defaults, appends a valid session id, and rejects bad input", () => {
  assert.equal(resolveReturnTarget({ result: "success", app: "shareswap:///subscription?sub_success=true", session_id: "cs_test_abc" }, HOSTS), "shareswap:///subscription?sub_success=true&session_id=cs_test_abc");
  assert.equal(resolveReturnTarget({ result: "success" }, HOSTS), "shareswap://subscription?sub_success=true");
  assert.equal(resolveReturnTarget({ result: "canceled" }, HOSTS), "shareswap://subscription?sub_canceled=true");
  assert.equal(resolveReturnTarget({ result: "done" }, HOSTS), "shareswap://subscription");
  assert.equal(resolveReturnTarget({ result: "success", session_id: "{CHECKOUT_SESSION_ID}" }, HOSTS), "shareswap://subscription?sub_success=true");
  assert.equal(resolveReturnTarget({ result: "success", app: "https://evil.com/steal" }, HOSTS), "shareswap://subscription?sub_success=true");
  assert.equal(resolveReturnTarget({ result: "other" }, HOSTS), null);
  assert.equal(resolveReturnTarget({}, HOSTS), null);
});

function run(query: Record<string, unknown>) {
  const out: { status?: number; headers: Record<string, string>; body?: string } = { headers: {} };
  const res: any = {
    status(c: number) { out.status = c; return res; },
    set(h: Record<string, string>) { Object.assign(out.headers, h); return res; },
    type() { return res; },
    send(b: string) { out.body = b; return res; },
  };
  subscriptionReturnHandler({ getHosts: () => HOSTS })({ query } as any, res);
  return out;
}

test("return route redirects with an Open ShareSwap fallback page", () => {
  const r = run({ result: "success", app: "shareswap:///subscription?sub_success=true" });
  assert.equal(r.status, 302);
  assert.equal(r.headers.Location, "shareswap:///subscription?sub_success=true");
  assert.match(r.body!, /Open ShareSwap/);
  assert.match(r.body!, /href="shareswap:\/\/\/subscription\?sub_success=true"/);
});

test("return route never redirects to a foreign link and escapes the page", () => {
  const r = run({ result: "canceled", app: "https://evil.com/\"><script>x</script>" });
  assert.equal(r.headers.Location, "shareswap://subscription?sub_canceled=true");
  assert.ok(!r.body!.includes("evil.com"));
  assert.equal(run({ result: "nope" }).status, 400);
});

function session(over: Record<string, unknown> = {}) {
  return { id: "cs_test_1", mode: "subscription", status: "complete", payment_status: "paid", customer: "cus_1",
    metadata: { userId: "7", tier: "member" }, subscription: { id: "sub_1", status: "active", items: { data: [{ price: { product: { metadata: { tier: "pro" } } } }] } }, ...over };
}
function setup(s: unknown, storedCustomer: string | null = "cus_1") {
  const writes: unknown[] = [];
  const sub = (s as any).subscription;
  const stripe = {
    // Like Stripe, the session names its subscription by id; the subscription is read (and its product expanded) separately.
    checkout: { sessions: { retrieve: async (_id: string, params?: unknown) => {
      assert.equal(params, undefined, "the session is read without expansion: the product is too deep to expand from it");
      return { ...(s as object), subscription: sub?.id ?? null };
    } } },
    subscriptions: { retrieve: async (id: string, params: { expand?: string[] }) => {
      assert.equal(id, sub.id);
      assert.deepEqual(params.expand, ["items.data.price.product"]);
      return sub;
    } },
  } as any;
  const store: ConfirmStore = {
    getStripeCustomerId: async () => storedCustomer,
    setSubscription: async (userId, fields) => void writes.push({ userId, ...fields }),
  };
  return { stripe, store, writes };
}

test("confirm sets the tier for a paid session that belongs to the user", async () => {
  const { stripe, store, writes } = setup(session());
  const r = await confirmCheckoutSession(stripe, store, 7, "cs_test_1");
  assert.deepEqual(r, { status: 200, body: { confirmed: true, tier: "pro" } });
  assert.deepEqual(writes, [{ userId: 7, subscriptionTier: "pro", stripeSubscriptionId: "sub_1", stripeSubscriptionStatus: "active" }]);
});

test("confirm changes nothing for unpaid, incomplete, or non-subscription sessions", async () => {
  for (const over of [{ payment_status: "unpaid" }, { status: "open" }, { mode: "payment" }, { subscription: { id: "sub_1", status: "active", items: { data: [{ price: { product: { metadata: { tier: "admin" } } } }] } } }, { subscription: { id: "sub_1", status: "canceled", items: { data: [{ price: { product: { metadata: { tier: "pro" } } } }] } } }]) {
    const { stripe, store, writes } = setup(session(over));
    const r = await confirmCheckoutSession(stripe, store, 7, "cs_test_1");
    assert.equal(r.status, 200);
    assert.equal((r.body as any).confirmed, false);
    assert.deepEqual(writes, []);
  }
});

test("confirm refuses another user's session and malformed ids", async () => {
  const other = setup(session({ metadata: { userId: "8", tier: "pro" } }));
  assert.equal((await confirmCheckoutSession(other.stripe, other.store, 7, "cs_test_1")).status, 403);
  const wrongCustomer = setup(session(), "cus_other");
  assert.equal((await confirmCheckoutSession(wrongCustomer.stripe, wrongCustomer.store, 7, "cs_test_1")).status, 403);
  assert.deepEqual([...other.writes, ...wrongCustomer.writes], []);
  const { stripe, store } = setup(session());
  for (const bad of [undefined, "", "sub_1", "cs_../x", 5]) {
    assert.equal((await confirmCheckoutSession(stripe, store, 7, bad)).status, 400);
  }
});

test("confirm takes the tier from the subscription's current plan, not from the session's metadata", async () => {
  // The session was created for Member, but its subscription has since moved to Pro: confirming must not undo that.
  const { stripe, store, writes } = setup(session({ metadata: { userId: "7", tier: "member" } }));
  const r = await confirmCheckoutSession(stripe, store, 7, "cs_test_1");
  assert.deepEqual(r, { status: 200, body: { confirmed: true, tier: "pro" } });
  assert.equal((writes[0] as any).subscriptionTier, "pro");
});
