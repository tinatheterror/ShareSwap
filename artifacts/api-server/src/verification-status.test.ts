import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { db, pool, users, verifications } from "@workspace/db";
import { hashPassword } from "./auth.js";
import { Client, startApp } from "./auth-test-client.js";
import { getIdVerificationSummary, getVerificationForUser } from "./verification.js";

const unique = `verification-status-${Date.now()}`;
const PASSWORD = "VerificationStatus!42";
let server: Awaited<ReturnType<typeof startApp>>;
const ids: Record<string, number> = {};
const clients: Record<string, Client> = {};

before(async () => {
  const password = await hashPassword(PASSWORD);
  // idonly: approved ID, no card. retry: approved, then started again (a later pending row). none: nothing yet.
  const names = ["idonly", "retry", "none"];
  const created = await db.insert(users).values(names.map((n) => ({ username: `${unique}-${n}`, password, emailVerified: true }))).returning();
  names.forEach((n, i) => (ids[n] = created[i].id));
  await db.insert(verifications).values([
    { userId: ids.idonly, fullName: "Ida Only", idNumber: "PERSONA_VERIFIED", status: "approved" },
    { userId: ids.retry, fullName: "Rita Retry", idNumber: "PERSONA_VERIFIED", status: "approved", createdAt: new Date(Date.now() - 86_400_000) },
    { userId: ids.retry, status: "pending", idNumber: "x", personaStatus: "completed" },
  ] as any);
  server = await startApp();
  for (const n of names) {
    const c = new Client(server.baseUrl);
    assert.equal((await c.post("/api/login", { username: `${unique}-${n}`, password: PASSWORD })).status, 200);
    await c.fetchCsrfToken();
    clients[n] = c;
  }
});

after(async () => {
  try {
    const all = Object.values(ids);
    await db.delete(verifications).where(inArray(verifications.userId, all));
    await db.delete(users).where(inArray(users.id, all));
  } finally {
    await server.close();
    await pool.end();
  }
});

test("/api/verification-status uses the same rule as getVerificationForUser: an approved ID is never shown as Under Review because of a later row", async () => {
  const status = async (who: string) => ((await (await clients[who].get("/api/verification-status")).json()) as any);
  const retry = await status("retry");
  assert.equal(retry.status, "verified");
  assert.equal(retry.legalFullName, "Rita Retry");
  assert.equal((await getVerificationForUser(ids.retry)).idVerified, true, "and the capability check agrees");
  assert.equal((await getIdVerificationSummary(ids.retry)).status, "verified");
  assert.equal((await status("idonly")).status, "verified", "an approved ID without a card is verified here too");
  assert.equal((await status("none")).status, "unverified");

  await db.insert(verifications).values({ userId: ids.none, status: "pending", idNumber: "x", personaStatus: "created" } as any);
  assert.equal((await status("none")).status, "unverified", "a started-but-unsubmitted inquiry is unverified");
  await db.update(verifications).set({ personaStatus: "completed" }).where(eq(verifications.userId, ids.none));
  assert.equal((await status("none")).status, "pending");
  await db.update(verifications).set({ status: "rejected" }).where(eq(verifications.userId, ids.none));
  assert.equal((await status("none")).status, "failed");
  assert.equal((await new Client(server.baseUrl).get("/api/verification-status")).status, 401);
});

