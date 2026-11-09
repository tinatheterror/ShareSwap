import assert from "node:assert/strict";
import { test } from "node:test";
import { runPersonaSandboxCheck, SANDBOX_KEY_PREFIX } from "./persona-sandbox-check.js";

const KEY = `${SANDBOX_KEY_PREFIX}abc123`;

/** A fake Persona sandbox that remembers what was created and redacted. `accountFilterWorks` / `redactWorks` switch on the failure modes the check exists to catch. */
function fakePersona(opts: { accountFilterWorks?: boolean; redactWorks?: boolean } = {}) {
  const { accountFilterWorks = true, redactWorks = true } = opts;
  const calls: string[] = [];
  const state = { inquiryRedacted: false, accountRedacted: false, reference: "" };
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
  const fetchImpl = (async (input: any, init: any) => {
    const url = String(input).replace("https://api.withpersona.com/api/v1", "");
    const method = init?.method ?? "GET";
    calls.push(`${method} ${url}`);
    assert.equal(init.headers.Authorization, `Bearer ${KEY}`);
    if (method === "POST" && url === "/inquiries") {
      const body = JSON.parse(init.body);
      state.reference = body.data.attributes["reference-id"];
      return json(201, { data: { id: "inq_sb_1", attributes: { status: "created" } } });
    }
    if (url === "/inquiries/inq_sb_1") {
      if (method === "DELETE") { if (redactWorks) state.inquiryRedacted = true; return json(redactWorks ? 200 : 404, {}); }
      return json(200, { data: { id: "inq_sb_1", attributes: { status: "created", redactedAt: state.inquiryRedacted ? "2026-11-10T00:00:00Z" : null }, relationships: { account: { data: { id: "act_sb_1" } } } } });
    }
    if (url.startsWith("/accounts?")) return json(200, { data: accountFilterWorks ? [{ id: "act_sb_1", attributes: { referenceId: state.reference } }] : [], links: { next: null } });
    if (url === "/accounts/act_sb_1") {
      if (method === "DELETE") { if (redactWorks) state.accountRedacted = true; return json(redactWorks ? 200 : 404, {}); }
      return json(200, { data: { id: "act_sb_1", attributes: { redactedAt: state.accountRedacted ? "2026-11-10T00:00:00Z" : null } } });
    }
    throw new Error(`unexpected ${method} ${url}`);
  }) as typeof fetch;
  return { fetchImpl, calls, state };
}

test("refuses a key that is not a sandbox key, or a missing template, without calling Persona", async () => {
  for (const apiKey of [undefined, "", "persona_production_abc", "sk_live_x"]) {
    const persona = fakePersona();
    const report = await runPersonaSandboxCheck({ apiKey, templateId: "itmpl_1", fetchImpl: persona.fetchImpl });
    assert.equal(report.passed, false);
    assert.match(report.steps[0].detail, /persona_sandbox_/);
    assert.deepEqual(persona.calls, []);
  }
  const persona = fakePersona();
  assert.match((await runPersonaSandboxCheck({ apiKey: KEY, templateId: undefined, fetchImpl: persona.fetchImpl })).steps[0].detail, /PERSONA_SANDBOX_TEMPLATE_ID/);
  assert.deepEqual(persona.calls, []);
});

test("a working Persona passes every step: create, find the account by reference id, redact with our client, and both read back as redacted", async () => {
  const persona = fakePersona();
  const lines: string[] = [];
  const report = await runPersonaSandboxCheck({ apiKey: KEY, templateId: "itmpl_1", fetchImpl: persona.fetchImpl, log: (l) => lines.push(l), now: () => 1700000000000 });
  assert.equal(report.passed, true, lines.join("\n"));
  assert.deepEqual(report.steps.map((s) => s.name), [
    "create inquiry", "inquiry before redaction", "find the account by reference id", "redact the inquiry with our client", "inquiry after redaction",
    "redact account act_sb_1 with our client", "account act_sb_1 after redaction",
  ]);
  assert.equal(persona.state.reference, "user_sandbox_1700000000000");
  assert.ok(persona.calls.includes("DELETE /inquiries/inq_sb_1") && persona.calls.includes("DELETE /accounts/act_sb_1"));
  assert.ok(lines.every((l) => !l.includes(KEY)), "the key is never printed");
  assert.match(lines.join("\n"), /redacted-at 2026-11-10/);
});

test("it reports the failures it exists to catch: a redact call that does nothing, and a reference-id lookup that finds no account", async () => {
  const original = console.error;
  console.error = () => {};
  try {
    const broken = await runPersonaSandboxCheck({ apiKey: KEY, templateId: "itmpl_1", fetchImpl: fakePersona({ redactWorks: false }).fetchImpl });
    assert.equal(broken.passed, false);
    const redactStep = broken.steps.find((s) => s.name === "redact the inquiry with our client")!;
    assert.equal(redactStep.ok, false);
    assert.match(redactStep.detail, /NOT redacted/);
    assert.equal(broken.steps.find((s) => s.name === "inquiry after redaction")!.ok, false);

    const noAccount = await runPersonaSandboxCheck({ apiKey: KEY, templateId: "itmpl_1", fetchImpl: fakePersona({ accountFilterWorks: false }).fetchImpl });
    assert.equal(noAccount.passed, false);
    const lookup = noAccount.steps.find((s) => s.name === "find the account by reference id")!;
    assert.equal(lookup.ok, false);
    assert.match(lookup.detail, /returned nothing/);
    assert.equal(noAccount.steps.find((s) => s.name === "inquiry after redaction")!.ok, true, "the inquiry part still passed");
  } finally {
    console.error = original;
  }
});
