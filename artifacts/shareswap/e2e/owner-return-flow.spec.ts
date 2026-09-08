import { expect, test } from "@playwright/test";

type OwnerReturnFixture = {
  fixtureId: string;
  owner: { username: string; password: string };
  requestId: number;
};

test("owner sees a failed return confirmation without losing the dialog", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const fixtureResponse = await page.request.post(
    "/api/e2e/owner-return-fixture",
  );
  expect(fixtureResponse.ok()).toBe(true);
  const fixture = (await fixtureResponse.json()) as OwnerReturnFixture;

  try {
    const loginResponse = await page.request.post("/api/login", {
      data: fixture.owner,
    });
    expect(loginResponse.ok()).toBe(true);

    await page.route(
      `**/api/requests/${fixture.requestId}/confirm-return`,
      async (route) => {
        await route.continue({
          headers: {
            ...route.request().headers(),
            "x-e2e-simulate-failure": "owner-return-confirmation",
          },
        });
      },
    );

    await page.goto("/requests");
    await page.getByRole("button", { name: "Open inbox" }).click();
    await page.getByRole("button", { name: /Ben Borrower/ }).click();
    await page
      .getByRole("button", { name: "Confirm return", exact: true })
      .last()
      .click();

    const dialog = page.getByRole("dialog", { name: "Confirm Item Return" });
    await expect(dialog).toBeVisible();

    const confirmationRequest = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        request.url().endsWith(
          `/api/requests/${fixture.requestId}/confirm-return`,
        ),
    );
    const confirmationResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith(
          `/api/requests/${fixture.requestId}/confirm-return`,
        ),
    );

    await dialog.getByRole("button", { name: "Confirm Return" }).click();

    const [request, response] = await Promise.all([
      confirmationRequest,
      confirmationResponse,
    ]);
    expect(request.headers()["x-e2e-simulate-failure"]).toBe(
      "owner-return-confirmation",
    );
    expect(response.status()).toBe(500);

    await expect(dialog).toBeVisible();
    await expect(
      page.getByText("Confirmation failed", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Return could not be saved", { exact: true }),
    ).toBeVisible();
  } finally {
    await page.request.post("/api/e2e/owner-return-fixture/cleanup", {
      data: { fixtureId: fixture.fixtureId },
    });
  }
});