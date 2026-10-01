export type ApiEnvironment = {
  kind: "development" | "production" | "unknown";
  label: string;
  host: string;
  description: string;
};

// Verified ShareSwap published custom domain. Match exactly, never by substring.
const PRODUCTION_CUSTOM_HOSTS = new Set(["shareswap.app"]);

export function getApiEnvironment(baseUrl: string | null | undefined): ApiEnvironment {
  const unknown = (host: string): ApiEnvironment => ({
    kind: "unknown",
    label: "Unknown environment",
    host,
    description: "Check the API configuration before using this account.",
  });
  if (!baseUrl?.trim()) return unknown("Not configured");

  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return unknown("Invalid API address");
  }

  const host = url.hostname.toLowerCase();
  if (!host || host === "undefined" || host === "null") return unknown("Not configured");
  if (url.username || url.password) return unknown(url.host);

  const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(host);
  if (
    (url.protocol === "https:" && host.endsWith(".replit.dev")) ||
    (isLocal && ["https:", "http:"].includes(url.protocol))
  ) {
    return {
      kind: "development",
      label: "Development",
      host: url.host,
      description: "Test accounts and data",
    };
  }

  if (
    url.protocol === "https:" &&
    (host.endsWith(".replit.app") || PRODUCTION_CUSTOM_HOSTS.has(host))
  ) {
    return {
      kind: "production",
      label: "Production",
      host: url.host,
      description: "Live accounts and data",
    };
  }

  return unknown(url.host);
}