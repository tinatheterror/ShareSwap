import type Stripe from "stripe";

/**
 * The lazy Stripe client the routes use: every method resolves the real client on first call. It is written out by hand, so a
 * method the code calls but nobody added here is "not a function" at run time (customers.retrieve was exactly that: the pre-charge
 * card check threw, and was skipped, on every real charge). stripe-lazy-client.test.ts runs it against the real SDK client.
 */
export function createLazyStripe(getStripe: () => Promise<Stripe>) {
  return {
    customers: {
      retrieve: async (...args: Parameters<Stripe['customers']['retrieve']>) => {
        const s = await getStripe();
        return s.customers.retrieve(...args);
      },
      update: async (...args: Parameters<Stripe['customers']['update']>) => {
        const s = await getStripe();
        return s.customers.update(...args);
      },
      create: async (...args: Parameters<Stripe['customers']['create']>) => {
        const s = await getStripe();
        return s.customers.create(...args);
      },
    },
    setupIntents: {
      create: async (...args: Parameters<Stripe['setupIntents']['create']>) => {
        const s = await getStripe();
        return s.setupIntents.create(...args);
      },
    },
    paymentIntents: {
      create: async (...args: Parameters<Stripe['paymentIntents']['create']>) => {
        const s = await getStripe();
        return s.paymentIntents.create(...args);
      },
      retrieve: async (...args: Parameters<Stripe['paymentIntents']['retrieve']>) => {
        const s = await getStripe();
        return s.paymentIntents.retrieve(...args);
      },
      update: async (...args: Parameters<Stripe['paymentIntents']['update']>) => {
        const s = await getStripe();
        return s.paymentIntents.update(...args);
      },
      cancel: async (...args: Parameters<Stripe['paymentIntents']['cancel']>) => {
        const s = await getStripe();
        return s.paymentIntents.cancel(...args);
      },
      capture: async (...args: Parameters<Stripe['paymentIntents']['capture']>) => {
        const s = await getStripe();
        return s.paymentIntents.capture(...args);
      },
    },
    paymentMethods: {
      retrieve: async (...args: Parameters<Stripe['paymentMethods']['retrieve']>) => {
        const s = await getStripe();
        return s.paymentMethods.retrieve(...args);
      },
      attach: async (...args: Parameters<Stripe['paymentMethods']['attach']>) => {
        const s = await getStripe();
        return s.paymentMethods.attach(...args);
      },
      detach: async (...args: Parameters<Stripe['paymentMethods']['detach']>) => {
        const s = await getStripe();
        return s.paymentMethods.detach(...args);
      },
    },
    refunds: {
      create: async (...args: Parameters<Stripe["refunds"]["create"]>) => {
        const s = await getStripe();
        return s.refunds.create(...args);
      },
      list: async (...args: Parameters<Stripe["refunds"]["list"]>) => {
        const s = await getStripe();
        return s.refunds.list(...args);
      },
      retrieve: async (...args: Parameters<Stripe["refunds"]["retrieve"]>) => {
        const s = await getStripe();
        return s.refunds.retrieve(...args);
      },
    },
    checkout: {
      sessions: {
        create: async (...args: Parameters<Stripe['checkout']['sessions']['create']>) => {
          const s = await getStripe();
          return s.checkout.sessions.create(...args);
        },
        retrieve: async (...args: Parameters<Stripe['checkout']['sessions']['retrieve']>) => {
          const s = await getStripe();
          return s.checkout.sessions.retrieve(...args);
        },
      },
    },
    accounts: {
      create: async (...args: Parameters<Stripe['accounts']['create']>) => {
        const s = await getStripe();
        return s.accounts.create(...args);
      },
      retrieve: async (...args: Parameters<Stripe['accounts']['retrieve']>) => {
        const s = await getStripe();
        return s.accounts.retrieve(...args);
      },
    },
    accountLinks: {
      create: async (...args: Parameters<Stripe['accountLinks']['create']>) => {
        const s = await getStripe();
        return s.accountLinks.create(...args);
      },
    },
    transfers: {
      create: async (...args: Parameters<Stripe['transfers']['create']>) => {
        const s = await getStripe();
        return s.transfers.create(...args);
      },
    },
  };
}
