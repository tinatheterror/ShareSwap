import { getUncachableStripeClient } from '../server/stripe.server';

async function seedProducts() {
  const stripe = await getUncachableStripeClient();

  // Check if products already exist
  const existing = await stripe.products.search({ query: "metadata['app']:'shareswap'" });
  if (existing.data.length > 0) {
    console.log('ShareSwap subscription products already exist:');
    for (const p of existing.data) {
      const prices = await stripe.prices.list({ product: p.id, active: true });
      for (const price of prices.data) {
        console.log(`  ${p.name} (tier: ${p.metadata.tier}): price ID = ${price.id}`);
      }
    }
    return;
  }

  console.log('Creating ShareSwap Member plan...');
  const memberProduct = await stripe.products.create({
    name: 'ShareSwap Member',
    description: 'Unlimited borrows, priority matching',
    metadata: { tier: 'member', app: 'shareswap' },
  });
  const memberPrice = await stripe.prices.create({
    product: memberProduct.id,
    unit_amount: 499,
    currency: 'usd',
    recurring: { interval: 'month' },
    metadata: { tier: 'member' },
  });
  console.log(`✅ Member plan created. Price ID: ${memberPrice.id}`);

  console.log('Creating ShareSwap Pro plan...');
  const proProduct = await stripe.products.create({
    name: 'ShareSwap Pro',
    description: 'Unlimited borrows, priority matching, rental analytics, instant approval, 2% fee',
    metadata: { tier: 'pro', app: 'shareswap' },
  });
  const proPrice = await stripe.prices.create({
    product: proProduct.id,
    unit_amount: 999,
    currency: 'usd',
    recurring: { interval: 'month' },
    metadata: { tier: 'pro' },
  });
  console.log(`✅ Pro plan created. Price ID: ${proPrice.id}`);

  console.log('\nDone! Products seeded successfully.');
}

seedProducts().catch(console.error);
