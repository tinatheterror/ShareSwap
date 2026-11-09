import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { db, disputeEvidence, itemRequests, items, pool, securityClaims, users } from "@workspace/db";
import { applyLegacyEvidenceCleanup, describeLegacyPlan, planLegacyEvidence } from "./legacy-evidence-cleanup.js";

const unique = `legacy-evidence-${Date.now()}`;
let ownerId: number, borrowerId: number, itemId: number, requestId: number, claimId: number, evidenceId: number;
const pub = (n: string) => `/storage/images/${unique}-${n}.jpg`;
const onlyMine = (plan: Awaited<ReturnType<typeof planLegacyEvidence>>) => ({ ...plan, refs: plan.refs.filter((r) => r.url.includes(unique)), files: plan.files.filter((f) => f.url.includes(unique)) });

before(async () => {
  const created = await db.insert(users).values([{ username: `${unique}-o`, password: "x", emailVerified: true }, { username: `${unique}-b`, password: "x", emailVerified: true }]).returning();
  [ownerId, borrowerId] = created.map((u) => u.id);
  const [item] = await db.insert(items).values({ ownerId, name: `${unique}-item`, description: "d", conditionRating: 5, photos: [pub("listing")], shareCoinsReward: "0" }).returning();
  itemId = item.id;
  const [request] = await db.insert(itemRequests).values({ itemId, requesterId: borrowerId, requestType: "RENT", status: "DISPUTED", paymentCurrency: "cad", depositMethod: "in_person", returnDisputePhotoUrl: pub("return") } as any).returning();
  requestId = request.id;
  const [claim] = await db.insert(securityClaims).values({
    requestId, ownerId, borrowerId, claimType: "damage", status: "CLOSED", reason: "r", requestedAmount: "5.00",
    evidence: [pub("claim"), "/api/private-files/" + "a".repeat(32), "https://example.com/x.jpg", "free text"],
  } as any).returning();
  claimId = claim.id;
  const [ev] = await db.insert(disputeEvidence).values({ disputeId: unique, userId: ownerId, note: "n", photoUrls: [pub("dispute"), pub("listing"), "/uploads/" + unique + ".jpg"] }).returning();
  evidenceId = ev.id;
});

after(async () => {
  try {
    await db.delete(disputeEvidence).where(eq(disputeEvidence.id, evidenceId));
    await db.delete(securityClaims).where(eq(securityClaims.id, claimId));
    await db.delete(itemRequests).where(eq(itemRequests.id, requestId));
    await db.delete(items).where(eq(items.id, itemId));
    await db.delete(users).where(inArray(users.id, [ownerId, borrowerId]));
  } finally {
    await pool.end();
  }
});

test("the plan lists every public evidence reference by record, keeps private tokens and outside links out, and flags a file shared with a listing photo", async () => {
  const plan = onlyMine(await planLegacyEvidence());
  assert.deepEqual(plan.refs.map((r) => r.table).sort(), ["dispute_evidence", "dispute_evidence", "dispute_evidence", "item_requests", "security_claims"]);
  assert.equal(plan.refs.length, 5);
  assert.equal(plan.files.find((f) => f.url === pub("listing"))!.sharedWithPublicPhoto, true);
  assert.equal(plan.files.filter((f) => !f.sharedWithPublicPhoto).length, 4);
  assert.match(describeLegacyPlan(plan), /Files to delete/);
  assert.ok((await planLegacyEvidence()).external >= 1, "the outside link is counted, not touched");
});

test("a dry run changes nothing; apply deletes the files, clears the references, and keeps the listing photo, private tokens and notes", async () => {
  const removed: string[] = [];
  const plan = onlyMine(await planLegacyEvidence());
  const before = (await db.select().from(securityClaims).where(eq(securityClaims.id, claimId)))[0].evidence;
  assert.equal(removed.length, 0);
  assert.deepEqual((await db.select().from(securityClaims).where(eq(securityClaims.id, claimId)))[0].evidence, before, "planning does not write");

  const result = await applyLegacyEvidenceCleanup(plan, async (url) => {
    removed.push(url);
    return url.endsWith("dispute.jpg") ? "failed" : "deleted";
  });
  assert.ok(!removed.includes(pub("listing")), "a file used as a listing photo is never deleted");
  assert.deepEqual(result.filesFailed, [pub("dispute")]);
  assert.equal(result.filesKept, 1);

  const claim = (await db.select().from(securityClaims).where(eq(securityClaims.id, claimId)))[0];
  assert.deepEqual(claim.evidence, ["/api/private-files/" + "a".repeat(32), "https://example.com/x.jpg", "free text"]);
  assert.equal((await db.select().from(itemRequests).where(eq(itemRequests.id, requestId)))[0].returnDisputePhotoUrl, null);
  const ev = (await db.select().from(disputeEvidence).where(eq(disputeEvidence.id, evidenceId)))[0];
  assert.deepEqual(ev.photoUrls, [pub("dispute")], "the one file that failed to delete keeps its reference so a re-run finds it");
  assert.equal(ev.note, "n");
  assert.equal((await db.select().from(items).where(eq(items.id, itemId)))[0].photos[0], pub("listing"), "the listing photo is untouched");

  const again = await applyLegacyEvidenceCleanup(onlyMine(await planLegacyEvidence()), async () => "deleted");
  assert.deepEqual([again.filesDeleted, again.filesFailed.length], [1, 0]);
  assert.deepEqual((await db.select().from(disputeEvidence).where(eq(disputeEvidence.id, evidenceId)))[0].photoUrls, []);
  assert.equal(onlyMine(await planLegacyEvidence()).refs.length, 0, "nothing left to find");
});
