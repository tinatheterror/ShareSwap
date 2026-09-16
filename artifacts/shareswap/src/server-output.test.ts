import { describe, expect, it } from "vitest";
import { findUnexpectedServerOutput } from "../e2e/server-output";

function captured(message: string, stream = "stderr") {
  return `${JSON.stringify({ stream, message })}\n`;
}

describe("API server output analysis", () => {
  it("reports structured API errors", () => {
    const findings = findUnexpectedServerOutput(
      captured('{"level":50,"msg":"Server error","err":{"message":"boom"}}'),
    );
    expect(findings).toHaveLength(1);
  });

  it("reports database failures from stderr", () => {
    const findings = findUnexpectedServerOutput(
      captured('error: column "missing_field" does not exist'),
    );
    expect(findings).toHaveLength(1);
  });

  it("reports unhandled server failures", () => {
    const findings = findUnexpectedServerOutput(
      captured("UnhandledPromiseRejection: background task exploded"),
    );
    expect(findings).toHaveLength(1);
  });

  it("allows known intentional fixture failures without allowing generic errors", () => {
    expect(
      findUnexpectedServerOutput(
        captured("E2E simulated owner-return fixture setup failure"),
      ),
    ).toEqual([]);
    expect(
      findUnexpectedServerOutput(captured("database connection failure")),
    ).toHaveLength(1);
  });

  it("ignores ordinary startup and request output", () => {
    expect(
      findUnexpectedServerOutput(
        captured("API server listening on port 4180", "stdout") +
          captured("GET /api/csrf-token 200", "stdout"),
      ),
    ).toEqual([]);
  });
});