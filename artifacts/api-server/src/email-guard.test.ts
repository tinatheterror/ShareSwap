import assert from "node:assert/strict";
import { test } from "node:test";
import { assertRealSendAllowed, chooseEmailMode, EmailGuardError } from "./email-guard.js";
import { fakeMailFailure, getMailClient, sentMail } from "./mail.js";

test("in a test process mail is always the fake sender, and EMAIL_MODE=live is refused", () => {
  assert.equal(chooseEmailMode({}, true, false), "fake");
  assert.equal(chooseEmailMode({ EMAIL_MODE: "log" }, true, false), "fake");
  assert.equal(chooseEmailMode({ RESEND_API_KEY: "re_x" }, true, true), "fake");
  assert.throws(() => chooseEmailMode({ EMAIL_MODE: "live" }, true, false), EmailGuardError);
});

test("outside tests: log by default in dev, live by default in production, EMAIL_MODE overrides", () => {
  assert.equal(chooseEmailMode({}, false, false), "log");
  assert.equal(chooseEmailMode({ EMAIL_MODE: "live" }, false, false), "live");
  assert.equal(chooseEmailMode({}, false, true), "live");
  assert.equal(chooseEmailMode({ EMAIL_MODE: " LOG " }, false, true), "log");
  assert.throws(() => chooseEmailMode({ EMAIL_MODE: "maybe" }, false, false), EmailGuardError);
});

test("the Resend call itself refuses to run in a test process", () => {
  assert.throws(() => assertRealSendAllowed({}, true), EmailGuardError);
  assert.doesNotThrow(() => assertRealSendAllowed({}, false));
});

test("this process really uses the fake sender: nothing reaches fetch, the message is recorded", async () => {
  const realFetch = globalThis.fetch;
  let fetched = 0;
  globalThis.fetch = (async () => { fetched++; return new Response("{}"); }) as typeof fetch;
  sentMail.length = 0;
  try {
    const { client } = getMailClient();
    await client.send({ to: "a@example.test", subject: "hi", text: "hello" });
    assert.equal(fetched, 0);
    assert.deepEqual(sentMail.map((m) => [m.to, m.subject]), [["a@example.test", "hi"]]);
    fakeMailFailure.error = new Error("boom");
    await assert.rejects(client.send({ to: "a@example.test", subject: "x" }), /boom/);
  } finally {
    fakeMailFailure.error = null;
    sentMail.length = 0;
    globalThis.fetch = realFetch;
  }
});
