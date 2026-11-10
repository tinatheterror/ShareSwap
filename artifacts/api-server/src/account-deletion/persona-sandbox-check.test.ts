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

test("a failed step prints Persona's error title and detail, never the key or headers", async () => {
  const lines: string[] = [];
  const fetchImpl = (async () => new Response(JSON.stringify({ errors: [{ title: "Forbidden", detail: "Inquiry template itmpl_1 is not accessible with this key", status: 403 }, { title: "Second", details: "more" }] }), { status: 403, headers: { "x-secret": KEY } })) as typeof fetch;
  const report = await runPersonaSandboxCheck({ apiKey: KEY, templateId: "itmpl_1", fetchImpl, log: (l) => lines.push(l) });
  assert.equal(report.passed, false);
  const detail = report.steps[0].detail;
  assert.match(detail, /Persona answered 403 - Persona said: Forbidden: Inquiry template itmpl_1 is not accessible with this key; Second: more/);
  assert.ok(lines.every((l) => !l.includes(KEY)));
});

test("a failure inside our client (find account) also carries Persona's error text", async () => {
  const persona = fakePersona();
  const fetchImpl = (async (input: any, init: any) => String(input).includes("/accounts?")
    ? new Response(JSON.stringify({ errors: [{ title: "Not Authorized", detail: "key lacks accounts:read" }] }), { status: 403 })
    : persona.fetchImpl(input, init)) as typeof fetch;
  const report = await runPersonaSandboxCheck({ apiKey: KEY, templateId: "itmpl_1", fetchImpl });
  const step = report.steps.find((s) => s.name === "find the account by reference id")!;
  assert.equal(step.ok, false);
  assert.match(step.detail, /Persona said: Not Authorized: key lacks accounts:read/);
});

test("with an existing inquiry id it skips creation and runs fetch, find account, redact and verify on it", async () => {
  const persona = fakePersona();
  // Hand-made inquiry: the fake serves inq_sb_1 with a reference id taken from the account lookup, so give it one.
  persona.state.reference = "member_ref_1";
  const inner = persona.fetchImpl;
  const fetchImpl = (async (input: any, init: any) => {
    const r = await inner(input, init);
    if (String(input).endsWith("/inquiries/inq_sb_1") && (init?.method ?? "GET") === "GET") {
      const body: any = await r.json();
      body.data.attributes.referenceId = "member_ref_1";
      return new Response(JSON.stringify(body), { status: 200 });
    }
    return r;
  }) as typeof fetch;
  const report = await runPersonaSandboxCheck({ apiKey: KEY, templateId: undefined, inquiryId: "inq_sb_1", fetchImpl });
  assert.equal(report.passed, true, JSON.stringify(report.steps));
  assert.ok(!persona.calls.includes("POST /inquiries"), "nothing is created");
  assert.ok(!report.steps.some((s) => s.name === "create inquiry"));
  assert.ok(persona.calls.includes("DELETE /inquiries/inq_sb_1") && persona.calls.includes("DELETE /accounts/act_sb_1"));
});

test("an existing inquiry without a reference id fails the lookup step honestly but still redacts its account; a malformed id is refused", async () => {
  const persona = fakePersona();
  const report = await runPersonaSandboxCheck({ apiKey: KEY, templateId: undefined, inquiryId: "inq_sb_1", fetchImpl: persona.fetchImpl });
  const lookup = report.steps.find((s) => s.name === "find the account by reference id")!;
  assert.equal(lookup.ok, false);
  assert.match(lookup.detail, /NOT tested/);
  assert.ok(persona.calls.includes("DELETE /accounts/act_sb_1"));

  const other = fakePersona();
  const bad = await runPersonaSandboxCheck({ apiKey: KEY, templateId: undefined, inquiryId: "not-an-id", fetchImpl: other.fetchImpl });
  assert.equal(bad.passed, false);
  assert.deepEqual(other.calls, []);
});
