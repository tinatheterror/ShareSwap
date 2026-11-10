import { createPersonaClient } from "./persona-redaction";

/**
 * A one-off check of our Persona redaction against Persona's SANDBOX: creates a test inquiry, redacts it (and its account) with the same
 * client account deletion uses, fetches both afterwards and reports what Persona says. Run by hand (scripts/persona-sandbox-check.ts);
 * it refuses any key that is not a sandbox key, so it can never touch real members' data.
 */
export const SANDBOX_KEY_PREFIX = "persona_sandbox_";

export type SandboxCheckStep = { name: string; ok: boolean; detail: string };
export type SandboxCheckReport = { steps: SandboxCheckStep[]; passed: boolean };

const attributesOf = (body: any) => body?.data?.attributes ?? {};
/** Only Persona's own error text (errors[].title / detail), never a header and never the request. */
export function describePersonaErrors(body: any): string {
  const errors = Array.isArray(body?.errors) ? body.errors : [];
  const parts = errors.map((e: any) => [e?.title, e?.detail ?? e?.details].filter((x) => typeof x === "string" && x).join(": ")).filter(Boolean);
  return parts.join("; ");
}

const redactedAtOf = (body: any) => attributesOf(body).redactedAt ?? attributesOf(body)["redacted-at"] ?? null;

export async function runPersonaSandboxCheck(options: { apiKey: string | undefined; templateId: string | undefined; inquiryId?: string; fetchImpl?: typeof fetch; log?: (line: string) => void; now?: () => number }): Promise<SandboxCheckReport> {
  const log = options.log ?? (() => {});
  const steps: SandboxCheckStep[] = [];
  const step = (name: string, ok: boolean, detail: string) => { steps.push({ name, ok, detail }); log(`${ok ? "PASS" : "FAIL"}  ${name}: ${detail}`); return ok; };
  const finish = (): SandboxCheckReport => ({ steps, passed: steps.every((s) => s.ok) });

  const { apiKey, templateId } = options;
  if (!apiKey || !apiKey.startsWith(SANDBOX_KEY_PREFIX)) {
    step("key", false, `PERSONA_SANDBOX_API_KEY must be set and start with ${SANDBOX_KEY_PREFIX}; refusing to run (this check creates and destroys data)`);
    return finish();
  }
  if (options.inquiryId !== undefined && !/^inq_[A-Za-z0-9_]+$/.test(options.inquiryId)) {
    step("inquiry id", false, "--inquiry-id must look like inq_... (the id of a SANDBOX inquiry you created in the dashboard)");
    return finish();
  }
  if (!templateId && !options.inquiryId) {
    step("template", false, "PERSONA_SANDBOX_TEMPLATE_ID is not set (the inquiry template id of your sandbox, itmpl_...)");
    return finish();
  }

  const baseFetch = options.fetchImpl ?? fetch;
  // Remembers Persona's error text from the latest failed response so a step can show why it failed.
  let lastFailure = "";
  const doFetch = (async (input: any, init?: any) => {
    const response = await baseFetch(input, init);
    lastFailure = "";
    if (!response.ok) {
      const body = await response.clone().json().catch(() => null);
      lastFailure = describePersonaErrors(body);
    }
    return response;
  }) as typeof fetch;
  const why = () => (lastFailure ? ` - Persona said: ${lastFailure}` : "");
  const api = "https://api.withpersona.com/api/v1";
  const headers = { Authorization: `Bearer ${apiKey}`, "Persona-Version": "2023-01-05", "Key-Inflection": "camel", "Content-Type": "application/json" };
  const get = async (path: string) => {
    const response = await doFetch(`${api}${path}`, { method: "GET", headers });
    return { status: response.status, body: await response.json().catch(() => null) as any, why: why() };
  };
  // The same client account deletion uses, pointed at the sandbox key.
  const client = createPersonaClient({ env: { PERSONA_API_KEY: apiKey }, fetchImpl: doFetch });
  let referenceId: string | null = `user_sandbox_${(options.now ?? Date.now)()}`;
  let inquiryId: string | undefined = options.inquiryId;

  if (!inquiryId) {
    const created = await doFetch(`${api}/inquiries`, {
      method: "POST", headers,
      body: JSON.stringify({ data: { type: "inquiry", attributes: { "inquiry-template-id": templateId, "reference-id": referenceId, fields: { nameFirst: "Sandbox", nameLast: "Check" } } } }),
    });
    const createdBody: any = await created.json().catch(() => null);
    inquiryId = createdBody?.data?.id;
    if (!step("create inquiry", created.ok && !!inquiryId, created.ok ? `${inquiryId} (reference id ${referenceId})` : `Persona answered ${created.status}${why()}`)) return finish();
  } else {
    log(`Using the existing sandbox inquiry ${inquiryId} (creation skipped)`);
  }

  const before = await get(`/inquiries/${inquiryId}`);
  const accountId: string | undefined = before.body?.data?.relationships?.account?.data?.id;
  if (options.inquiryId) referenceId = attributesOf(before.body).referenceId ?? attributesOf(before.body)["reference-id"] ?? null;
  const beforeOk = before.status === 200 && !redactedAtOf(before.body);
  step("inquiry before redaction", beforeOk, `GET ${before.status}, status ${attributesOf(before.body).status}, redacted-at ${redactedAtOf(before.body) ?? "null"}, reference id ${referenceId ?? "none"}, account ${accountId ?? "none shown"}${before.status === 200 ? "" : before.why}`);
  if (options.inquiryId && !beforeOk) return finish();

  let foundAccounts: string[] = [];
  try {
    if (!referenceId) {
      // A hand-made inquiry may have no reference id: the lookup cannot be tested, so say so (a failure, not a silent pass) and still redact its account.
      foundAccounts = accountId ? [accountId] : [];
      step("find the account by reference id", false, `the inquiry has no reference id, so the lookup was NOT tested; redacting its own account ${accountId ?? "(none shown)"} instead. Create the inquiry with a reference id to test the lookup`);
    } else {
    foundAccounts = await client.findAccountIds(referenceId);
    const linked = !!accountId && foundAccounts.includes(accountId);
    step("find the account by reference id", foundAccounts.length > 0, `filter[reference-id]=${referenceId} returned ${foundAccounts.length ? foundAccounts.join(", ") : "nothing"}${accountId ? (linked ? " (includes the inquiry's account)" : ` (the inquiry's account ${accountId} is not among them)`) : ""}`);
    }
  } catch (error) {
    step("find the account by reference id", false, (error instanceof Error ? error.message : String(error)) + why());
  }

  try {
    await client.redactInquiry(inquiryId!);
    step("redact the inquiry with our client", true, "no error");
  } catch (error) {
    step("redact the inquiry with our client", false, (error instanceof Error ? error.message : String(error)) + why());
  }
  const after = await get(`/inquiries/${inquiryId}`);
  step("inquiry after redaction", after.status === 404 || (after.status === 200 && !!redactedAtOf(after.body)), after.status === 404 ? "GET 404 (gone)" : `GET ${after.status}, status ${attributesOf(after.body).status}, redacted-at ${redactedAtOf(after.body) ?? "null (NOT redacted)"}${after.status === 200 ? "" : after.why}`);

  for (const id of foundAccounts) {
    try {
      await client.redactAccount(id);
      step(`redact account ${id} with our client`, true, "no error");
    } catch (error) {
      step(`redact account ${id} with our client`, false, (error instanceof Error ? error.message : String(error)) + why());
    }
    const account = await get(`/accounts/${id}`);
    step(`account ${id} after redaction`, account.status === 404 || (account.status === 200 && !!redactedAtOf(account.body)), account.status === 404 ? "GET 404 (gone)" : `GET ${account.status}, redacted-at ${redactedAtOf(account.body) ?? "null (NOT redacted)"}${account.status === 200 ? "" : account.why}`);
  }
  return finish();
}
