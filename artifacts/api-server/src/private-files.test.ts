import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { inArray } from "drizzle-orm";
import { db, evidenceUploads, notifications, itemRequests, items, pool, securityClaims, users } from "@workspace/db";
import { hashPassword } from "./auth.js";
import { Client, startApp } from "./auth-test-client.js";
import { allUploadedBy, privateTokenOf, readPrivateUpload } from "./private-files.js";
import { deletePrivateFile } from "./storage.js";

const unique = `private-files-${Date.now()}`;
const PASSWORD = "PrivateFiles!42";
let ownerId: number, borrowerId: number, strangerId: number, adminId: number, itemId: number, requestId: number;
let server: Awaited<ReturnType<typeof startApp>>;
const clients: Record<string, Client> = {};
const claimIds: number[] = [];

const form = (bytes: string) => {
  const f = new FormData();
  f.append("photo", new Blob([bytes], { type: "image/jpeg" }), "photo.jpg");
  return f;
};
const upload = async (who: string, path: string, bytes: string) => {
  const res = await clients[who].postForm(path, form(bytes));
  assert.equal(res.status, 200, path);
  return ((await res.json()) as { url: string }).url;
};

before(async () => {
  const password = await hashPassword(PASSWORD);
  const created = await db.insert(users).values(
    ["owner", "borrower", "stranger", "admin"].map((name) => ({ username: `${unique}-${name}`, password, emailVerified: true, isAdmin: name === "admin" })),
  ).returning();
  [ownerId, borrowerId, strangerId, adminId] = created.map((u) => u.id);
  const [item] = await db.insert(items).values({ ownerId, name: `${unique}-item`, description: "private files", conditionRating: 5, photos: [], shareCoinsReward: "0" }).returning();
  itemId = item.id;
  const [request] = await db.insert(itemRequests).values({ itemId, requesterId: borrowerId, requestType: "RENT", status: "RETURN_REQUESTED", paymentCurrency: "cad", depositMethod: "in_person" } as any).returning();
  requestId = request.id;
  server = await startApp();
  for (const [i, name] of ["owner", "borrower", "stranger", "admin"].entries()) {
    const c = new Client(server.baseUrl);
    assert.equal((await c.post("/api/login", { username: created[i].username, password: PASSWORD })).status, 200);
    await c.fetchCsrfToken();
    clients[name] = c;
  }
});

after(async () => {
  try {
    const ids = [ownerId, borrowerId, strangerId, adminId];
    for (const u of await db.select({ key: evidenceUploads.storageKey }).from(evidenceUploads).where(inArray(evidenceUploads.userId, ids))) if (u.key) await deletePrivateFile(u.key);
    await db.delete(evidenceUploads).where(inArray(evidenceUploads.userId, ids));
    await db.delete(notifications).where(inArray(notifications.userId, ids));
    if (claimIds.length) await db.delete(securityClaims).where(inArray(securityClaims.id, claimIds));
    await db.delete(itemRequests).where(inArray(itemRequests.id, [requestId]));
    await db.delete(items).where(inArray(items.id, [itemId]));
    await db.delete(users).where(inArray(users.id, ids));
  } finally {
    await server.close();
    await pool.end();
  }
});

test("claim evidence and return-dispute photos are private: no public URL, an unguessable token, and each route needs a login", async () => {
  for (const path of ["/api/uploads/claim-evidence", "/api/uploads/dispute-photo", "/api/uploads/dispute-evidence"]) {
    const anon = new Client(server.baseUrl);
    await anon.fetchCsrfToken();
    assert.equal((await anon.postForm(path, form("x"))).status, 401, path);
    const url = await upload("owner", path, "bytes");
    assert.match(url, /^\/api\/private-files\/[0-9a-f]{32}$/, path);
    assert.ok(!url.startsWith("/storage/") && !url.startsWith("/uploads/"), `${path} must not return a public URL`);
    const [row] = await db.select().from(evidenceUploads).where(inArray(evidenceUploads.token, [privateTokenOf(url)!]));
    assert.ok(row.storageKey!.startsWith("private/"));
    assert.equal((await clients.stranger.get(`/storage/${row.storageKey}`)).status, 404);
  }
});

test("a claim photo can be read by its uploader, the two parties of the claim and admins, and nobody else", async () => {
  const url = await upload("owner", "/api/uploads/claim-evidence", "claim-bytes");
  const token = privateTokenOf(url)!;
  // Not yet attached to a claim: only the uploader and admins.
  assert.equal((await clients.owner.get(url)).status, 200);
  assert.equal((await clients.admin.get(url)).status, 200);
  assert.equal((await clients.borrower.get(url)).status, 404);

  const [claim] = await db.insert(securityClaims).values({
    requestId, ownerId, borrowerId, claimType: "damage", status: "CUSTOMER_RESPONSE_PENDING", reason: "cracked", evidence: [url, "a note"], requestedAmount: "10.00",
  } as any).returning();
  claimIds.push(claim.id);
  const read = await clients.borrower.get(url);
  assert.equal(read.status, 200, "the borrower the claim is against can see its evidence");
  assert.equal(await read.text(), "claim-bytes");
  assert.equal(read.headers.get("cache-control"), "private, no-store");
  assert.equal((await clients.stranger.get(url)).status, 404, "an unrelated member cannot");
  assert.equal((await new Client(server.baseUrl).get(url)).status, 401);
  assert.equal(await readPrivateUpload(token, { id: strangerId }), null);
});

test("a return-dispute photo can be read by the rental's two parties once attached, and not by others", async () => {
  const url = await upload("owner", "/api/uploads/dispute-photo", "return-bytes");
  assert.equal((await clients.borrower.get(url)).status, 404, "not attached yet");
  await db.update(itemRequests).set({ returnDisputePhotoUrl: url }).where(inArray(itemRequests.id, [requestId]));
  assert.equal((await clients.borrower.get(url)).status, 200);
  assert.equal((await clients.owner.get(url)).status, 200);
  assert.equal((await clients.stranger.get(url)).status, 404);
});

test("each flow accepts only its own purpose and only the uploader's files", async () => {
  const claimFile = await upload("owner", "/api/uploads/claim-evidence", "a");
  const returnFile = await upload("owner", "/api/uploads/dispute-photo", "b");
  assert.equal(await allUploadedBy([claimFile], ownerId, "claim_evidence"), true);
  assert.equal(await allUploadedBy([claimFile], ownerId, "return_dispute"), false, "wrong purpose");
  assert.equal(await allUploadedBy([returnFile], ownerId, "dispute_evidence"), false, "wrong purpose");
  assert.equal(await allUploadedBy([claimFile], strangerId, "claim_evidence"), false, "someone else's file");
  assert.equal(await allUploadedBy(["/storage/images/x.jpg"], ownerId, "claim_evidence"), false, "a public path");

  // Opening a claim: public paths and other people's files are refused before anything else happens.
  const open = (evidence: string[]) => clients.owner.post(`/api/requests/${requestId}/claims`, { claimType: "damage", reason: "cracked", requestedAmount: 5, evidence });
  assert.equal((await open(["/storage/images/x.jpg"])).status, 400);
  assert.equal((await open(["/uploads/x.jpg"])).status, 400);
  assert.equal((await open([returnFile])).status, 400, "a file made for another flow");
  assert.equal((await clients.stranger.post(`/api/requests/${requestId}/claims`, { claimType: "damage", reason: "x", requestedAmount: 5, evidence: [claimFile] })).status, 400, "someone else's upload");
  assert.notEqual((await open([claimFile, "free text note"])).status, 400, "own claim file and plain text pass this check");

  // Reporting a return: the photo must be the member's own return-dispute upload.
  const confirm = (disputePhotoUrl: string) => clients.owner.post(`/api/requests/${requestId}/confirm-return`, { triggerDispute: true, conditionNotes: "x", disputePhotoUrl });
  assert.equal((await confirm("/storage/images/x.jpg")).status, 400);
  assert.equal((await confirm(claimFile)).status, 400);
});
