import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { aiConsents, db, pool, users } from "@workspace/db";
import { hashPassword } from "./auth.js";
import { Client, startApp } from "./auth-test-client.js";
import { AI_CONSENT_VERSION, AI_FEATURES, AI_FEATURE_KEYS, consentedAiFeatures } from "./ai-consent.js";
import { calculateAIValuation } from "./ai-valuation.js";
import { TERMS_VERSION } from "./legal-config.js";

// Nothing goes to OpenAI for a person who has not agreed to that feature: the routes whose whole point is the AI call refuse
// with AI_CONSENT_REQUIRED, and the profile photo check saves the photo unchecked.

const UNIQUE = `aiconsent-${Date.now()}`;
const PASSWORD = "Consent!4242";
const userIds: number[] = [];
let baseUrl: string;
let closeServer: () => Promise<void>;
let fakeOpenAi: Server;
let openAiHits = 0;
const previousBase = { url: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL, key: process.env.AI_INTEGRATIONS_OPENAI_API_KEY };

const clearLimiter = () => pool.query("DELETE FROM rate_limit_store WHERE key LIKE 'auth:%'");

before(async () => {
  fakeOpenAi = createServer((req, res) => {
    openAiHits++;
    req.resume();
    res.writeHead(500, { "content-type": "application/json" }).end("{}");
  });
  await new Promise<void>((resolve) => fakeOpenAi.listen(0, "127.0.0.1", resolve));
  const address = fakeOpenAi.address();
  assert(address && typeof address !== "string");
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = `http://127.0.0.1:${address.port}/v1`;
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "test-key";
  ({ baseUrl, close: closeServer } = await startApp());
  await clearLimiter();
});

after(async () => {
  try {
    if (userIds.length) {
      await db.delete(aiConsents).where(inArray(aiConsents.userId, userIds));
      await db.delete(users).where(inArray(users.id, userIds));
    }
    await clearLimiter();
  } finally {
    for (const [name, value] of [["AI_INTEGRATIONS_OPENAI_BASE_URL", previousBase.url], ["AI_INTEGRATIONS_OPENAI_API_KEY", previousBase.key]] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await closeServer?.();
    await new Promise((resolve) => fakeOpenAi.close(resolve));
    await pool.end();
  }
});

async function makeUser(label: string) {
  const [row] = await db
    .insert(users)
    .values({ username: `${UNIQUE}-${label}`, password: await hashPassword(PASSWORD), emailVerified: true, termsAcceptedAt: new Date(), termsVersion: TERMS_VERSION })
    .returning();
  userIds.push(row.id);
  return row;
}

async function signIn(user: { username: string }) {
  await clearLimiter();
  const client = new Client(baseUrl);
  assert.equal((await client.post("/api/login", { username: user.username, password: PASSWORD })).status, 200);
  await client.fetchCsrfToken();
  return client;
}

const GATED: readonly (readonly [string, string])[] = [
  ["smartscan", "/api/smartscan/analyze"],
  ["listing_autofill", "/api/listings/ai-generate"],
  ["screenshot_import", "/api/import-from-screenshot"],
  ["category_suggestion", "/api/detect-category"],
];

test("the feature list is public, names OpenAI, and says what is shared and what happens without consent", async () => {
  const response = await new Client(baseUrl).get("/api/ai-consent/features");
  assert.equal(response.status, 200);
  const body = (await response.json()) as { provider: string; version: string; features: { key: string; shared: string; withoutConsent: string }[] };
  assert.equal(body.provider, "OpenAI");
  assert.equal(body.version, AI_CONSENT_VERSION);
  assert.deepEqual(body.features.map((feature) => feature.key), [...AI_FEATURE_KEYS]);
  for (const feature of body.features) {
    assert.ok(feature.shared.length > 10 && feature.withoutConsent.length > 10, feature.key);
  }
});

test("without consent each AI-only route refuses with AI_CONSENT_REQUIRED and calls nobody; with it the route goes on to its own checks", async () => {
  const user = await makeUser("gated");
  const client = await signIn(user);
  const hitsBefore = openAiHits;
  for (const [feature, path] of GATED) {
    const refused = await client.post(path, {});
    assert.equal(refused.status, 403, path);
    const body = (await refused.json()) as { code: string; feature: string; message: string };
    assert.equal(body.code, "AI_CONSENT_REQUIRED", path);
    assert.equal(body.feature, feature);
    assert.match(body.message, /OpenAI/);
    assert.doesNotMatch(body.message, /csrf|token/i, "clients retry a 403 that mentions these");
  }
  assert.equal(openAiHits, hitsBefore, "nothing was sent");

  const agreed = await client.post("/api/ai-consent", { features: GATED.map(([feature]) => feature) });
  assert.equal(agreed.status, 200);
  for (const [, path] of GATED) {
    const response = await client.post(path, {});
    assert.equal(response.status, 400, `${path} now reaches its own validation (no images / no name)`);
  }
});

test("consent is per person and per feature, can be withdrawn, and a changed wording asks again", async () => {
  const a = await makeUser("a");
  const b = await makeUser("b");
  const clientA = await signIn(a);
  const clientB = await signIn(b);

  assert.equal((await clientA.post("/api/ai-consent", { feature: "smartscan" })).status, 200);
  assert.deepEqual(await consentedAiFeatures(a.id), ["smartscan"]);
  assert.deepEqual(await consentedAiFeatures(b.id), [], "another person is not affected");
  assert.equal((await clientB.post("/api/smartscan/analyze", {})).status, 403);
  assert.equal((await clientA.post("/api/listings/ai-generate", {})).status, 403, "other features are asked separately");

  const me = (await (await clientA.get("/api/user")).json()) as { aiConsents: string[] };
  assert.deepEqual(me.aiConsents, ["smartscan"]);

  assert.equal((await clientA.post("/api/ai-consent", { feature: "not-a-feature" })).status, 400);
  assert.equal((await clientA.post("/api/ai-consent", { features: [] })).status, 400);
  assert.equal((await clientA.post("/api/ai-consent", {})).status, 400);

  await db.update(aiConsents).set({ version: "2020-01-01" }).where(eq(aiConsents.userId, a.id));
  assert.deepEqual(await consentedAiFeatures(a.id), [], "an older wording no longer counts");
  assert.equal((await clientA.post("/api/smartscan/analyze", {})).status, 403);

  assert.equal((await clientA.post("/api/ai-consent", { feature: "smartscan" })).status, 200);
  assert.equal((await clientA.post("/api/ai-consent", { feature: "smartscan" })).status, 200, "agreeing twice is fine");
  assert.equal((await clientA.delete("/api/ai-consent/smartscan")).status, 200);
  assert.deepEqual(await consentedAiFeatures(a.id), []);
  assert.equal((await clientA.delete("/api/ai-consent/nope")).status, 400);

  const anonymous = new Client(baseUrl);
  await anonymous.fetchCsrfToken();
  assert.equal((await anonymous.post("/api/ai-consent", { feature: "smartscan" })).status, 401);
  assert.equal((await anonymous.get("/api/ai-consent")).status, 401);
});

test("the valuation sends nothing to OpenAI unless allowed, whatever the tier, and still returns a value", async () => {
  const hits = openAiHits;
  for (const tier of [1, 2, 3, 4, 9]) {
    const input = { tier, condition: "Good", conditionRating: 7, brand: "Acme", category: "Tools", itemType: "Tools", name: "cordless drill", description: "works", originalValue: "$50–$199", estimatedValue: null };
    const result = await calculateAIValuation(input as never, { allowAi: false });
    assert.ok(result.shareCoinsValue >= result.tierBand.min && result.shareCoinsValue <= result.tierBand.max, `tier ${tier}`);
  }
  assert.equal(openAiHits, hits, "no request left the server");
});

test("the Privacy Policy draft describes every AI feature and names OpenAI", () => {
  const policy = readFileSync(new URL("../../../docs/legal/privacy-policy.md", import.meta.url), "utf8");
  assert.match(policy, /OpenAI/);
  for (const feature of AI_FEATURES) assert.ok(policy.includes(feature.title), `the policy names "${feature.title}"`);
});
