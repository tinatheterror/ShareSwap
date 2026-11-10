import { pathToFileURL } from "node:url";
import { runPersonaSandboxCheck } from "../account-deletion/persona-sandbox-check";

// Checks our Persona redaction against Persona's SANDBOX (creates a test inquiry, redacts it and its account, fetches them, prints the result).
//   PERSONA_SANDBOX_API_KEY=persona_sandbox_... PERSONA_SANDBOX_TEMPLATE_ID=itmpl_... pnpm --filter @workspace/api-server run persona:sandbox-check
//   Add --inquiry-id inq_... to skip creating the inquiry and run the remaining steps on a sandbox inquiry you made by hand in the dashboard
//   (then PERSONA_SANDBOX_TEMPLATE_ID is not needed).
// Refuses any key that does not start with persona_sandbox_. Exits 1 if any step fails.
function inquiryIdArg(argv: string[]): string | undefined {
  const equals = argv.find((a) => a.startsWith("--inquiry-id="));
  if (equals) return equals.slice("--inquiry-id=".length);
  const at = argv.indexOf("--inquiry-id");
  if (at === -1) return undefined;
  return argv[at + 1] ?? "";
}

async function main() {
  const report = await runPersonaSandboxCheck({
    apiKey: process.env.PERSONA_SANDBOX_API_KEY,
    templateId: process.env.PERSONA_SANDBOX_TEMPLATE_ID,
    inquiryId: inquiryIdArg(process.argv.slice(2)),
    log: (line) => console.log(line),
  });
  console.log(report.passed ? "\nALL STEPS PASSED: the endpoints, the 404 handling and the reference-id lookup behave as the deletion code assumes." : "\nSOME STEPS FAILED: do not rely on Persona redaction until these are understood (see docs/pre-deploy-checklist.md).");
  if (!report.passed) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
