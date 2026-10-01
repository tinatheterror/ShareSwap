import { getApiEnvironment } from "../apiEnvironment";

describe("API environment detection", () => {
  test("recognizes development API hosts, including Expo development hosts", () => {
    for (const url of ["https://project.spock.replit.dev", "https://project.expo.spock.replit.dev"]) {
      expect(getApiEnvironment(url)).toMatchObject({ kind: "development", label: "Development" });
    }
  });

  test("recognizes published API and verified ShareSwap custom domain", () => {
    for (const url of ["https://share-swap-mvp.replit.app", "https://shareswap.app"]) {
      expect(getApiEnvironment(url)).toMatchObject({ kind: "production", label: "Production" });
    }
  });

  test("a production API remains production regardless of the installed build type", () => {
    expect(getApiEnvironment("https://shareswap.app").kind).toBe("production");
  });

  test("matches domains exactly instead of trusting similar names", () => {
    for (const url of [
      "https://shareswap.app.other.test",
      "https://project.replit.dev.other.test",
      "https://notreplit.dev",
      "https://staging.example.com",
    ]) {
      expect(getApiEnvironment(url).kind).toBe("unknown");
    }
  });

  test("reports missing and malformed configuration explicitly", () => {
    for (const url of [undefined, null, "", "https://undefined", "https://null"]) {
      expect(getApiEnvironment(url)).toMatchObject({ kind: "unknown", host: "Not configured" });
    }
    expect(getApiEnvironment("not a URL")).toMatchObject({ kind: "unknown", host: "Invalid API address" });
  });

  test("does not expose URL credentials or query values in the displayed host", () => {
    const result = getApiEnvironment("https://private:secret@shareswap.app?token=hidden");
    expect(result.kind).toBe("unknown");
    expect(result.host).toBe("shareswap.app");
    expect(JSON.stringify(result)).not.toMatch(/private|secret|hidden/);
  });

  test("recognizes local development and includes its port", () => {
    expect(getApiEnvironment("http://localhost:8080")).toMatchObject({
      kind: "development",
      host: "localhost:8080",
    });
  });

  test("does not label insecure or unsupported published URLs as production", () => {
    expect(getApiEnvironment("http://shareswap.app").kind).toBe("unknown");
    expect(getApiEnvironment("ftp://project.replit.dev").kind).toBe("unknown");
  });
});