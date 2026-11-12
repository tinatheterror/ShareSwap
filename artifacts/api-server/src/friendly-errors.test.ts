import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import express from "express";
import {
  GENERIC_SERVER_MESSAGE,
  describeUncaught,
  errorShield,
  installErrorHandlers,
  shieldBody,
} from "./friendly-errors.js";

const REF = /^SS-[0-9A-F]{8}$/;
const RAW_DB_ERROR = 'relation "item_requests" does not exist at /app/dist/index.mjs:123:45';

let baseUrl: string;
let close: () => Promise<void>;

before(async () => {
  const app = express();
  app.use(errorShield);
  app.use(express.json({ limit: "1kb" }));
  app.get("/api/ok", (_req, res) => res.json({ fine: true }));
  app.get("/api/bad-input", (_req, res) => res.status(400).json({ error: "Pick a date in the future." }));
  app.get("/api/raw-500", (_req, res) => res.status(500).json({ error: RAW_DB_ERROR }));
  app.get("/api/raw-502", (_req, res) => res.status(502).json({ error: "connect ECONNREFUSED 10.0.0.1:443" }));
  app.get("/api/coded-503", (_req, res) => res.status(503).json({ message: "Sign in with Apple is not available right now." }));
  app.get("/api/coded-500", (_req, res) => res.status(500).json({ code: "PAYMENT_STATE_UNKNOWN", error: "We couldn't confirm the payment." }));
  app.get("/api/throws", () => {
    throw new Error(RAW_DB_ERROR);
  });
  app.get("/api/rejects", (_req, _res, next) => next(new Error("password authentication failed for user postgres")));
  app.post("/api/echo", (req, res) => res.json(req.body));
  installErrorHandlers(app);
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => new Promise<void>((resolve) => server.close(() => resolve()));
});

after(() => close());

async function get(path: string) {
  const res = await fetch(`${baseUrl}${path}`);
  const text = await res.text();
  return { res, text, body: JSON.parse(text) as Record<string, unknown> };
}

test("a 2xx and a 4xx pass through untouched", async () => {
  assert.deepEqual((await get("/api/ok")).body, { fine: true });
  const bad = await get("/api/bad-input");
  assert.equal(bad.res.status, 400);
  assert.deepEqual(bad.body, { error: "Pick a date in the future." });
});

test("a 500 or 502 body with raw detail becomes a friendly message with a reference id", async () => {
  for (const [path, status] of [["/api/raw-500", 500], ["/api/raw-502", 502]] as const) {
    const { res, text, body } = await get(path);
    assert.equal(res.status, status);
    assert.equal(body.error, GENERIC_SERVER_MESSAGE);
    assert.equal(body.message, GENERIC_SERVER_MESSAGE);
    assert.match(String(body.referenceId), REF);
    assert.doesNotMatch(text, /relation|ECONNREFUSED|dist\/index/);
  }
});

test("a 503 and a coded 5xx keep their deliberate text and gain a reference id", async () => {
  const unavailable = await get("/api/coded-503");
  assert.equal(unavailable.res.status, 503);
  assert.equal(unavailable.body.message, "Sign in with Apple is not available right now.");
  assert.match(String(unavailable.body.referenceId), REF);

  const coded = await get("/api/coded-500");
  assert.equal(coded.body.code, "PAYMENT_STATE_UNKNOWN");
  assert.equal(coded.body.error, "We couldn't confirm the payment.");
  assert.match(String(coded.body.referenceId), REF);
});

test("an uncaught error answers JSON, not an HTML stack trace", async () => {
  for (const path of ["/api/throws", "/api/rejects"]) {
    const { res, text, body } = await get(path);
    assert.equal(res.status, 500);
    assert.match(res.headers.get("content-type") ?? "", /json/);
    assert.equal(body.error, GENERIC_SERVER_MESSAGE);
    assert.match(String(body.referenceId), REF);
    assert.doesNotMatch(text, /relation|password authentication|<html|\bat \w/i);
  }
});

test("each failure gets its own reference id", async () => {
  const a = (await get("/api/raw-500")).body.referenceId;
  const b = (await get("/api/raw-500")).body.referenceId;
  assert.notEqual(a, b);
});

test("an unknown /api path is JSON 404, a malformed body is a friendly 400, an oversized body a friendly 413", async () => {
  const missing = await get("/api/nope");
  assert.equal(missing.res.status, 404);
  assert.deepEqual(missing.body, { error: "We couldn't find that." });

  const malformed = await fetch(`${baseUrl}/api/echo`, { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" });
  assert.equal(malformed.status, 400);
  const malformedText = await malformed.text();
  assert.doesNotMatch(malformedText, /Unexpected token|SyntaxError|<html/i);
  assert.match(malformedText, /couldn't read that request/);

  const big = await fetch(`${baseUrl}/api/echo`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ x: "a".repeat(5000) }) });
  assert.equal(big.status, 413);
  assert.match(await big.text(), /too large/);
});

test("shieldBody and describeUncaught are pure", () => {
  assert.deepEqual(shieldBody(500, "plain string", "SS-00000000"), {
    error: GENERIC_SERVER_MESSAGE,
    message: GENERIC_SERVER_MESSAGE,
    referenceId: "SS-00000000",
  });
  assert.equal(describeUncaught(new Error("boom")).status, 500);
  assert.equal(describeUncaught(Object.assign(new Error("x"), { status: 418 })).status, 418);
});
