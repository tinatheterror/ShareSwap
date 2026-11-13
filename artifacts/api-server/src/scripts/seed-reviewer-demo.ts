import { pathToFileURL } from "node:url";
import { pool } from "@workspace/db";
import { assertDestructiveDatabaseAllowed } from "@workspace/db/test-database-guard";
import { getUncachableStripeClient } from "../stripe.server";
import { applyDemoAccount, describeDemoPlan, planDemoAccount, verifyStripeLinks, type StripeLinks } from "../demo-reviewer-account";

// Creates (or refreshes) the App Review demo account: ID-verified, Member plan, card on file, one completed transaction.
//   DEMO_EMAIL=... pnpm --filter @workspace/api-server run demo:seed-reviewer --stripe-customer=cus_... --stripe-payment-method=pm_... --stripe-subscription=sub_...
//       (dry run: reads the database and Stripe, writes nothing)
//   DEMO_EMAIL=... DEMO_PASSWORD=... ALLOW_NON_TEST_DATABASE=<database name> pnpm ... demo:seed-reviewer --apply --stripe-customer=... (writes)
// The email and password come from the environment so the password never lands in shell history or a process list. The Stripe objects are
// made by hand in the Stripe dashboard (docs/app-review-notes.md) and only read here. See src/demo-reviewer-account.ts for why.

const flag = (argv: string[], name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

async function main() {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const email = (process.env.DEMO_EMAIL ?? "").trim();
  const password = process.env.DEMO_PASSWORD;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email !== email.toLowerCase()) throw new Error("Set DEMO_EMAIL to a lowercase email address (it is also the sign-in name).");
  if (password !== undefined && password.length < 12) throw new Error("DEMO_PASSWORD must be at least 12 characters.");
  if (apply) assertDestructiveDatabaseAllowed("create or update the App Review demo account");

  const links = { customerId: flag(argv, "stripe-customer"), paymentMethodId: flag(argv, "stripe-payment-method"), subscriptionId: flag(argv, "stripe-subscription") };
  const stripe = await verifyStripeLinks(await getUncachableStripeClient(), links);
  const plan = await planDemoAccount(email, !!password);
  console.log(describeDemoPlan(plan, stripe));
  if (!apply) return console.log("\nDRY RUN: nothing was changed. Run again with --apply (and DEMO_PASSWORD when the account does not exist yet).");
  if (!stripe.ok) throw new Error("Refusing --apply: fix the Stripe problems above first.");
  if (!plan.demoExists && !password) throw new Error("Refusing --apply: DEMO_PASSWORD is required to create the account.");
  console.log("\n" + JSON.stringify(await applyDemoAccount({ email, password, links: links as StripeLinks, stripe: stripe.value }), null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; }).finally(() => pool.end());
}
