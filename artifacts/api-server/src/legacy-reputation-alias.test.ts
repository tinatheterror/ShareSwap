import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import { addLegacyReputationScore, legacyReputationScoreAlias } from "./legacy-reputation-alias.js";

test("an object with a numeric trustScore also gets reputationScore, at any depth, in arrays too", () => {
  const body = { user: { id: 1, trustScore: 320 }, partners: [{ trustScore: 0 }, { name: "no score" }], when: new Date(0) };
  const out: any = addLegacyReputationScore(body);
  assert.equal(out.user.reputationScore, 320);
  assert.equal(out.partners[0].reputationScore, 0);
  assert.equal("reputationScore" in out.partners[1], false);
  assert.ok(out.when instanceof Date);
});

test("an existing reputationScore is left alone, and non-numeric trustScore gets no alias", () => {
  assert.deepEqual(addLegacyReputationScore({ trustScore: 5, reputationScore: 9 }), { trustScore: 5, reputationScore: 9 });
  assert.deepEqual(addLegacyReputationScore({ trustScore: null }), { trustScore: null });
  assert.equal(addLegacyReputationScore(null), null);
  assert.equal(addLegacyReputationScore("text"), "text");
});

test("over HTTP, res.json carries both names", async () => {
  const app = express();
  app.use("/api", legacyReputationScoreAlias);
  app.get("/api/me", (_req, res) => res.json({ id: 7, trustScore: 150 }));
  const server = await new Promise<import("node:http").Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  try {
    const address = server.address();
    assert(address && typeof address !== "string");
    const body: any = await (await fetch(`http://127.0.0.1:${address.port}/api/me`)).json();
    assert.deepEqual(body, { id: 7, trustScore: 150, reputationScore: 150 });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  }
});
