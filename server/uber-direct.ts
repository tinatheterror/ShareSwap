const UBER_BASE_URL = 'https://api.uber.com';
const UBER_AUTH_URL = 'https://login.uber.com/oauth/v2/token';
const FETCH_TIMEOUT_MS = 10_000;

interface TokenCache {
  token: string;
  expiresAt: number;
}

let cachedToken: TokenCache | null = null;

function fetchWithTimeout(url: string, options: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { ...options, signal: controller.signal })
    .catch((err) => {
      if (err.name === 'AbortError') throw new Error('upstream request timeout');
      throw err;
    })
    .finally(() => clearTimeout(timer));
}

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }

  const clientId = process.env.UBER_CLIENT_ID;
  const clientSecret = process.env.UBER_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Uber Direct credentials not configured (UBER_CLIENT_ID / UBER_CLIENT_SECRET)');
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'eats.deliveries',
  });

  const res = await fetchWithTimeout(UBER_AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Uber auth failed (${res.status}): ${text}`);
  }

  const data = await res.json() as { access_token: string; expires_in: number };
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  return cachedToken.token;
}

export function isConfigured(): boolean {
  return !!(
    process.env.UBER_CLIENT_ID &&
    process.env.UBER_CLIENT_SECRET &&
    process.env.UBER_CUSTOMER_ID
  );
}

export interface DeliveryQuote {
  id: string;
  fee: number;
  currency: string;
  duration: number;
  expires: string;
}

export async function getDeliveryQuote(params: {
  pickupAddress: string;
  dropoffAddress: string;
  pickupPhone?: string;
  dropoffPhone?: string;
  manifestValueCents?: number;
}): Promise<DeliveryQuote> {
  const customerId = process.env.UBER_CUSTOMER_ID;
  if (!customerId) throw new Error('UBER_CUSTOMER_ID not configured');

  const token = await getAccessToken();

  const res = await fetchWithTimeout(`${UBER_BASE_URL}/v1/customers/${customerId}/delivery_quotes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      pickup_address: params.pickupAddress,
      dropoff_address: params.dropoffAddress,
      pickup_phone_number: params.pickupPhone || '+10000000000',
      dropoff_phone_number: params.dropoffPhone || '+10000000000',
      manifest_total_value: params.manifestValueCents ?? 0,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Uber quote error (${res.status}): ${JSON.stringify(err)}`);
  }

  const data = await res.json() as any;

  return {
    id: data.id,
    fee: data.fee,
    currency: data.currency ?? 'CAD',
    duration: data.duration,
    expires: data.expires,
  };
}

export interface CreatedDelivery {
  id: string;
  status: string;
  trackingUrl: string;
  fee: number;
  currency: string;
}

export async function createDelivery(params: {
  quoteId: string;
  pickupName?: string;
  pickupAddress: string;
  pickupPhone?: string;
  dropoffName?: string;
  dropoffAddress: string;
  dropoffPhone?: string;
  itemDescription: string;
  itemReference: string;
}): Promise<CreatedDelivery> {
  const customerId = process.env.UBER_CUSTOMER_ID;
  if (!customerId) throw new Error('UBER_CUSTOMER_ID not configured');

  const token = await getAccessToken();

  const res = await fetchWithTimeout(`${UBER_BASE_URL}/v1/customers/${customerId}/deliveries`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      quote_id: params.quoteId,
      pickup: {
        name: params.pickupName,
        address: params.pickupAddress,
        phone_number: params.pickupPhone || '+10000000000',
      },
      dropoff: {
        name: params.dropoffName,
        address: params.dropoffAddress,
        phone_number: params.dropoffPhone || '+10000000000',
      },
      manifest: {
        reference: params.itemReference,
        description: params.itemDescription,
      },
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Create delivery failed (${res.status}): ${JSON.stringify(err)}`);
  }

  const data = await res.json() as any;

  return {
    id: data.id,
    status: data.status,
    trackingUrl: data.tracking_url ?? '',
    fee: data.fee,
    currency: data.currency ?? 'CAD',
  };
}

export async function getDeliveryStatus(deliveryId: string): Promise<any> {
  const customerId = process.env.UBER_CUSTOMER_ID;
  if (!customerId) throw new Error('UBER_CUSTOMER_ID not configured');

  const token = await getAccessToken();

  const res = await fetchWithTimeout(`${UBER_BASE_URL}/v1/customers/${customerId}/deliveries/${deliveryId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    throw new Error(`Get delivery status failed (${res.status})`);
  }

  return res.json();
}
