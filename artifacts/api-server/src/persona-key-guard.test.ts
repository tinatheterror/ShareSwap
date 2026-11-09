import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq } from "drizzle-orm";
import { biometricConsents, db, notifications, pool, reputationActivities, shareCoinsTransactions, userAchievements, users, verifications } from "@workspace/db";
import { hashPassword } from "./auth.js";
import { Client, startApp } from "./auth-test-client.js";
import { BIOMETRIC_CONSENT_VERSION } from "./biometric-consent.js";
import {
  isPersonaSandboxKey, PERSONA_SANDBOX_KEY_IN_PRODUCTION_CODE, personaSandboxBootError, personaSandboxKeyInProduction,
} from "./persona-key-guard.js";

const SANDBOX = "persona_sandbox_abc123secret";
const PRODUCTION = "persona_production_def456secret";

test("only a persona_sandbox_ key is a sandbox key", () => {
  assert.equal(isPersonaSandboxKey(SANDBOX), true);
  assert.equal(isPersonaSandboxKey(`  ${SANDBOX}\n`), true, "stray whitespace in the secret does not hide it");
  assert.equal(isPersonaSandboxKey(PRODUCTION), false);
  assert.equal(isPersonaSandboxKey(""), false);
  assert.equal(isPersonaSandboxKey(undefined), false);
  assert.equal(isPersonaSandboxKey("PERSONA_SANDBOX_x"), false, "the prefix is case-sensitive, like Persona's");
});

test("a sandbox key is a problem in production (NODE_ENV or a Replit deployment) and only there", () => {
  const inProduction = (env: Record<string, string>) => personaSandboxKeyInProduction(env as NodeJS.ProcessEnv);
  assert.equal(inProduction({ NODE_ENV: "production", PERSONA_API_KEY: SANDBOX }), true);
  assert.equal(inProduction({ REPLIT_DEPLOYMENT: "1", PERSONA_API_KEY: SANDBOX }), true, "a deployment counts even without NODE_ENV");
  assert.equal(inProduction({ NODE_ENV: "production", PERSONA_API_KEY: PRODUCTION }), false);
  assert.equal(inProduction({ NODE_ENV: "production" }), false, "no key is a configuration error elsewhere, not this one");
  assert.equal(inProduction({ NODE_ENV: "development", PERSONA_API_KEY: SANDBOX }), false, "development keeps using the sandbox");
  assert.equal(inProduction({ PERSONA_API_KEY: SANDBOX }), false);
  assert.equal(inProduction({ NODE_ENV: "test", PERSONA_API_KEY: SANDBOX }), false);
});

test("the boot error names the problem and the fix and never the key", () => {
  const line = personaSandboxBootError({ NODE_ENV: "production", PERSONA_API_KEY: SANDBOX } as NodeJS.ProcessEnv);
  assert.ok(line);
  for (const needle of [/SANDBOX/, /production/, /create-inquiry/, /inquiry-complete/, /persona_production_/, /PERSONA_TEMPLATE_ID/]) assert.match(line, needle);
  assert.ok(!line.includes("secret") && !line.includes(SANDBOX), "the key value is never logged");
  assert.equal(personaSandboxBootError({ NODE_ENV: "production", PERSONA_API_KEY: PRODUCTION } as NodeJS.ProcessEnv), null);
  assert.equal(personaSandboxBootError({ NODE_ENV: "development", PERSONA_API_KEY: SANDBOX } as NodeJS.ProcessEnv), null);
});

// ---- the two endpoints, in the whole app ----
const unique = `persona-key-guard-${Date.now()}`;
const PASSWORD = "PersonaKeyGuard!42";
const INQUIRY = "inq_key_guard_test";
let server: Awaited<ReturnType<typeof startApp>>;
let userId: number;
let client: Client;

before(async () => {
  const [user] = await db.insert(users).values({ username: unique, password: await hashPassword(PASSWORD), emailVerified: true }).returning();
  userId = user.id;
  await db.insert(biometricConsents).values({ userId, version: BIOMETRIC_CONSENT_VERSION });
  server = await startApp();
  client = new Client(server.baseUrl);
  assert.equal((await client.post("/api/login", { username: unique, password: PASSWORD })).status, 200);
  await client.fetchCsrfToken();
});

after(async () => {
  try {
    // Approving a verification (test 3) writes these.
    for (const table of [notifications, reputationActivities, shareCoinsTransactions, userAchievements]) await db.delete(table).where(eq(table.userId, userId));
    await db.delete(biometricConsents).where(eq(biometricConsents.userId, userId));
    await db.delete(verifications).where(eq(verifications.userId, userId));
    await db.delete(users).where(eq(users.id, userId));
  } finally {
    await server.close();
    await pool.end();
  }
});

/** Runs fn with the given environment and Persona's API stubbed (it says every inquiry is approved); returns what the server asked Persona for. */
async function withEnv<T>(env: Record<string, string>, fn: () => Promise<T>): Promise<{ result: T; calls: string[]; errors: string[] }> {
  const names = ["PERSONA_API_KEY", "PERSONA_TEMPLATE_ID", "REPLIT_DEPLOYMENT"];
  const saved = names.map((n) => [n, process.env[n]] as const);
  for (const n of names) delete process.env[n];
  Object.assign(process.env, { PERSONA_TEMPLATE_ID: "itmpl_test", ...env });
  const realFetch = globalThis.fetch;
  const realError = console.error;
  const calls: string[] = [];
  const errors: string[] = [];
  console.error = (...args: unknown[]) => { errors.push(args.map(String).join(" ")); };
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input?.url ?? input);
    if (url.includes("api.withpersona.com")) {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      const body = init?.method === "POST"
        ? { data: { id: INQUIRY } }
        : { data: { id: INQUIRY, attributes: { status: "approved", nameFirst: "Ada", nameLast: "Lovelace" } } };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }
    return realFetch(input, init);
  }) as typeof fetch;
  try {
    return { result: await fn(), calls, errors };
  } finally {
    globalThis.fetch = realFetch;
    console.error = realError;
    for (const [n, v] of saved) { if (v === undefined) delete process.env[n]; else process.env[n] = v; }
  }
}

const rows = () => db.select().from(verifications).where(eq(verifications.userId, userId));
const userState = async () => (await db.select({ isVerified: users.isVerified, shareCoins: users.shareCoins }).from(users).where(eq(users.id, userId)))[0];

test("production + sandbox key: create-inquiry is refused with a clear error, nothing is created, no Persona call", async () => {
  const run = await withEnv({ REPLIT_DEPLOYMENT: "1", PERSONA_API_KEY: SANDBOX }, () => client.post("/api/persona/create-inquiry"));
  assert.equal(run.result.status, 503);
  const body = (await run.result.json()) as { code: string; error: string; message: string };
  assert.equal(body.code, PERSONA_SANDBOX_KEY_IN_PRODUCTION_CODE);
  assert.match(body.message, /not available/);
  assert.doesNotMatch(`${body.error} ${body.message}`, /csrf|token|sandbox|persona_/i, "members see no key talk, and no word both apps retry on");
  assert.deepEqual(run.calls, []);
  assert.deepEqual(await rows(), []);
  assert.equal(run.errors.length, 1, "each refusal is logged as an error for the operator");
  assert.match(run.errors[0], /sandbox key/);
  assert.ok(!run.errors[0].includes(SANDBOX), "the key is not logged");
});

test("production + sandbox key: inquiry-complete never approves, even when Persona says approved", async () => {
  await db.insert(verifications).values({ userId, personaInquiryId: INQUIRY, personaStatus: "created", status: "pending" });
  const before = await userState();
  const run = await withEnv({ REPLIT_DEPLOYMENT: "1", PERSONA_API_KEY: SANDBOX }, () => client.post("/api/persona/inquiry-complete", { inquiryId: INQUIRY }));
  assert.equal(run.result.status, 503);
  assert.equal(((await run.result.json()) as any).code, PERSONA_SANDBOX_KEY_IN_PRODUCTION_CODE);
  assert.deepEqual(run.calls, [], "Persona is not even asked");
  const [row] = await rows();
  assert.deepEqual([row.status, row.personaStatus, row.idNumber], ["pending", "created", null]);
  assert.deepEqual(await userState(), before, "not verified, no ShareCoins");
});

test("with the production key the same request is approved: the key is the only difference", async () => {
  const run = await withEnv({ REPLIT_DEPLOYMENT: "1", PERSONA_API_KEY: PRODUCTION }, () => client.post("/api/persona/inquiry-complete", { inquiryId: INQUIRY }));
  assert.equal(run.result.status, 200);
  assert.equal(((await run.result.json()) as any).status, "approved");
  assert.equal(run.calls.length, 1);
  assert.equal((await rows())[0].status, "approved");
  assert.deepEqual(run.errors, []);
});

test("outside production a sandbox key still works (development and the sandbox check)", async () => {
  await db.delete(verifications).where(eq(verifications.userId, userId));
  const run = await withEnv({ PERSONA_API_KEY: SANDBOX }, () => client.post("/api/persona/create-inquiry"));
  assert.equal(run.result.status, 200);
  assert.equal(((await run.result.json()) as any).inquiryId, INQUIRY);
  assert.equal(run.calls.length, 1);
  assert.equal((await rows()).length, 1);
});
