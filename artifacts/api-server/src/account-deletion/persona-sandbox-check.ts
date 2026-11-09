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
const redactedAtOf = (body: any) => attributesOf(body).redactedAt ?? attributesOf(body)["redacted-at"] ?? null;

export async function runPersonaSandboxCheck(options: { apiKey: string | undefined; templateId: string | undefined; fetchImpl?: typeof fetch; log?: (line: string) => void; now?: () => number }): Promise<SandboxCheckReport> {
  const log = options.log ?? (() => {});
  const steps: SandboxCheckStep[] = [];
  const step = (name: string, ok: boolean, detail: string) => { steps.push({ name, ok, detail }); log(`${ok ? "PASS" : "FAIL"}  ${name}: ${detail}`); return ok; };
  const finish = (): SandboxCheckReport => ({ steps, passed: steps.every((s) => s.ok) });

  const { apiKey, templateId } = options;
  if (!apiKey || !apiKey.startsWith(SANDBOX_KEY_PREFIX)) {
    step("key", false, `PERSONA_SANDBOX_API_KEY must be set and start with ${SANDBOX_KEY_PREFIX}; refusing to run (this check creates and destroys data)`);
    return finish();
  }
  if (!templateId) {
    step("template", false, "PERSONA_SANDBOX_TEMPLATE_ID is not set (the inquiry template id of your sandbox, itmpl_...)");
    return finish();
  }

  const doFetch = options.fetchImpl ?? fetch;
  const api = "https://api.withpersona.com/api/v1";
  const headers = { Authorization: `Bearer ${apiKey}`, "Persona-Version": "2023-01-05", "Key-Inflection": "camel", "Content-Type": "application/json" };
  const get = async (path: string) => {
    const response = await doFetch(`${api}${path}`, { method: "GET", headers });
    return { status: response.status, body: await response.json().catch(() => null) as any };
  };
  // The same client account deletion uses, pointed at the sandbox key.
  const client = createPersonaClient({ env: { PERSONA_API_KEY: apiKey }, fetchImpl: doFetch });
  const referenceId = `user_sandbox_${(options.now ?? Date.now)()}`;

  const created = await doFetch(`${api}/inquiries`, {
    method: "POST", headers,
    body: JSON.stringify({ data: { type: "inquiry", attributes: { "inquiry-template-id": templateId, "reference-id": referenceId, fields: { nameFirst: "Sandbox", nameLast: "Check" } } } }),
  });
  const createdBody: any = await created.json().catch(() => null);
  const inquiryId: string | undefined = createdBody?.data?.id;
  if (!step("create inquiry", created.ok && !!inquiryId, created.ok ? `${inquiryId} (reference id ${referenceId})` : `Persona answered ${created.status}`)) return finish();

  const before = await get(`/inquiries/${inquiryId}`);
  const accountId: string | undefined = before.body?.data?.relationships?.account?.data?.id;
  step("inquiry before redaction", before.status === 200 && !redactedAtOf(before.body), `GET ${before.status}, status ${attributesOf(before.body).status}, redacted-at ${redactedAtOf(before.body) ?? "null"}, account ${accountId ?? "none shown"}`);

  let foundAccounts: string[] = [];
  try {
    foundAccounts = await client.findAccountIds(referenceId);
    const linked = !!accountId && foundAccounts.includes(accountId);
    step("find the account by reference id", foundAccounts.length > 0, `filter[reference-id]=${referenceId} returned ${foundAccounts.length ? foundAccounts.join(", ") : "nothing"}${accountId ? (linked ? " (includes the inquiry's account)" : ` (the inquiry's account ${accountId} is not among them)`) : ""}`);
  } catch (error) {
    step("find the account by reference id", false, error instanceof Error ? error.message : String(error));
  }

  try {
    await client.redactInquiry(inquiryId!);
    step("redact the inquiry with our client", true, "no error");
  } catch (error) {
    step("redact the inquiry with our client", false, error instanceof Error ? error.message : String(error));
  }
  const after = await get(`/inquiries/${inquiryId}`);
  step("inquiry after redaction", after.status === 404 || (after.status === 200 && !!redactedAtOf(after.body)), after.status === 404 ? "GET 404 (gone)" : `GET ${after.status}, status ${attributesOf(after.body).status}, redacted-at ${redactedAtOf(after.body) ?? "null (NOT redacted)"}`);

  for (const id of foundAccounts) {
    try {
      await client.redactAccount(id);
      step(`redact account ${id} with our client`, true, "no error");
    } catch (error) {
      step(`redact account ${id} with our client`, false, error instanceof Error ? error.message : String(error));
    }
    const account = await get(`/accounts/${id}`);
    step(`account ${id} after redaction`, account.status === 404 || (account.status === 200 && !!redactedAtOf(account.body)), account.status === 404 ? "GET 404 (gone)" : `GET ${account.status}, redacted-at ${redactedAtOf(account.body) ?? "null (NOT redacted)"}`);
  }
  return finish();
}
