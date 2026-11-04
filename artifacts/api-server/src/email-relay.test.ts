import assert from "node:assert/strict";
import { after, test } from "node:test";
import { inArray } from "drizzle-orm";
import { appleLinks, db, pool, users } from "@workspace/db";
import { maskAddress, relayForwardingDisabled, sendUnlessRelayDisabled } from "./email-relay.js";

const UNIQUE = `relay-${Date.now()}`;
const ids: number[] = [];

after(async () => {
  try {
    if (ids.length) {
      await db.delete(appleLinks).where(inArray(appleLinks.userId, ids));
      await db.delete(users).where(inArray(users.id, ids));
    }
  } finally {
    await pool.end();
  }
});

async function relayUser(label: string, forwarding: boolean, email = `${UNIQUE}${label}@privaterelay.appleid.com`) {
  const [row] = await db.insert(users).values({ username: `${UNIQUE}-${label}`, email }).returning();
  ids.push(row.id);
  await db.insert(appleLinks).values({ userId: row.id, emailForwardingEnabled: forwarding });
  return email;
}

test("only a relay address whose forwarding Apple switched off is skipped", async () => {
  const off = await relayUser("off", false);
  const on = await relayUser("on", true);
  const ordinary = `${UNIQUE}-plain@example.com`;
  const [plainRow] = await db.insert(users).values({ username: `${UNIQUE}-plain`, email: ordinary }).returning();
  ids.push(plainRow.id);
  await db.insert(appleLinks).values({ userId: plainRow.id, emailForwardingEnabled: false }); // not a relay address: never looked at
  assert.equal(await relayForwardingDisabled(off), true);
  assert.equal(await relayForwardingDisabled(off.toUpperCase()), true);
  assert.equal(await relayForwardingDisabled(on), false);
  assert.equal(await relayForwardingDisabled(ordinary), false);
  assert.equal(await relayForwardingDisabled(`${UNIQUE}-unknown@privaterelay.appleid.com`), false);
});

test("the mailer sends nothing to a disabled relay address, logs the skip without the full address, and sends to everyone else", async () => {
  const off = await relayUser("send-off", false);
  const on = await relayUser("send-on", true);
  const sent: unknown[] = [];
  const sender = async (m: { to?: unknown }) => void sent.push(m.to);
  const logs: string[] = [];
  const log = console.log;
  console.log = (...args: unknown[]) => void logs.push(args.join(" "));
  try {
    assert.equal(await sendUnlessRelayDisabled(sender, { to: off, subject: "x" }), undefined);
    await sendUnlessRelayDisabled(sender, { to: on, subject: "x" });
    await sendUnlessRelayDisabled(sender, { to: "someone@example.com", subject: "x" });
    await sendUnlessRelayDisabled(sender, { to: [off, on], subject: "x" });
    await sendUnlessRelayDisabled(sender, { subject: "no recipient" });
  } finally {
    console.log = log;
  }
  assert.deepEqual(sent, [on, "someone@example.com", [on], undefined]);
  const skips = logs.filter((l) => l.includes("Skipped email"));
  assert.equal(skips.length, 2);
  assert.ok(skips.every((l) => l.includes("disabled") && !l.includes(off)));
});

test("forwarding switched back on resumes delivery", async () => {
  const address = await relayUser("toggle", false);
  const sent: unknown[] = [];
  await sendUnlessRelayDisabled(async (m: { to?: unknown }) => void sent.push(m.to), { to: address });
  assert.equal(sent.length, 0);
  await db.update(appleLinks).set({ emailForwardingEnabled: true }).where(inArray(appleLinks.userId, ids));
  await sendUnlessRelayDisabled(async (m: { to?: unknown }) => void sent.push(m.to), { to: address });
  assert.deepEqual(sent, [address]);
});

test("addresses are masked in logs", () => {
  assert.equal(maskAddress("abc123@privaterelay.appleid.com"), "a***@privaterelay.appleid.com");
});
