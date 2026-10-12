import type { IncomingHttpHeaders } from "node:http";

// Clients that predate the cancel penalty acknowledgment cannot show the penalty modal. For a limited
// period, a cancel from such a client goes through without the trust score penalty instead of failing.
//
// A "legacy" client is one that sends no x-app-version header. Every build that can show the modal
// sends the header (mobile: lib/api.ts; web: lib/queryClient.ts), so a request carrying the header,
// whatever its value, never gets the exemption.
//
// The period is the LEGACY_CANCEL_ACK_UNTIL environment variable, an ISO date/time. Unset, blank,
// unparseable or in the past means the exemption is off.
//
// This is a courtesy to old builds, not a security control: anyone can leave the header out.

export const APP_VERSION_HEADER = "x-app-version";
export const APP_BUILD_HEADER = "x-app-build";
export const LEGACY_CANCEL_ACK_UNTIL_ENV = "LEGACY_CANCEL_ACK_UNTIL";

function singleHeader(headers: IncomingHttpHeaders, name: string): string | null {
  const value = headers[name];
  if (value === undefined) return null;
  return Array.isArray(value) ? value.join(",") : value;
}

export function clientVersionOf(headers: IncomingHttpHeaders): { version: string | null; build: string | null } {
  return { version: singleHeader(headers, APP_VERSION_HEADER), build: singleHeader(headers, APP_BUILD_HEADER) };
}

// No x-app-version header at all. A present-but-empty header is not legacy.
export function isLegacyClient(headers: IncomingHttpHeaders): boolean {
  return headers[APP_VERSION_HEADER] === undefined;
}

export function legacyCancelAckDeadline(env: NodeJS.ProcessEnv = process.env): Date | null {
  const raw = env[LEGACY_CANCEL_ACK_UNTIL_ENV]?.trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function legacyCancelPenaltyExempt(
  headers: IncomingHttpHeaders,
  env: NodeJS.ProcessEnv = process.env,
  now: Date = new Date(),
): boolean {
  if (!isLegacyClient(headers)) return false;
  const deadline = legacyCancelAckDeadline(env);
  return deadline !== null && now.getTime() < deadline.getTime();
}
