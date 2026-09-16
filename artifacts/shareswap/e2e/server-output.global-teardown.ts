import { readFile } from "node:fs/promises";
import { findUnexpectedServerOutput } from "./server-output";

const logPath = "test-results/api-server.log";

export default async function checkApiServerOutput() {
  const logContents = await readFile(logPath, "utf8");
  const findings = findUnexpectedServerOutput(logContents);

  if (findings.length === 0) return;

  const context = findings
    .map(
      ({ stream, message }, index) =>
        `--- API server finding ${index + 1} (${stream}) ---\n${message.trim()}`,
    )
    .join("\n\n");

  throw new Error(
    `Browser checks detected ${findings.length} unexpected API server error(s).\n` +
      `Full captured output: ${logPath}\n\n${context}`,
  );
}