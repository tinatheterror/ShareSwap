import { expect, test } from "@playwright/test";

test("triggers a request-time server error", async ({ request }) => {
  const response = await request.get("http://127.0.0.1:4191/trigger");
  expect(response.ok()).toBe(true);
});