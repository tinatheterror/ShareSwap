import { expect, test, type APIRequestContext } from "@playwright/test";
import {
  cleanupOwnerReturnFixture,
  countFixtureRecords,
  suppressReturnReminderChecks,
  type OwnerReturnFixture,
} from "./owner-return-helpers";

type ReturnAlert = {
  id: number;
  requestId: number | null;
  type: string;
  title: string;
  message: string;
};

async function login(request: APIRequestContext, credentials: OwnerReturnFixture["owner"]) {
  expect((await request.post("/api/login", { data: credentials })).ok()).toBe(true);
}

async function mutationHeaders(request: APIRequestContext) {
  const response = await request.get("/api/csrf-token");
  expect(response.ok()).toBe(true);
  const { csrfToken } = await response.json() as { csrfToken: string };
  // Preserve the fixture's real session and Secure double-submit cookie on HTTP.
  const cookie = (await request.storageState()).cookies
    .map(entry => `${entry.name}=${entry.value}`).join("; ");
  return { "x-csrf-token": csrfToken, cookie };
}

async function alertsFor(request: APIRequestContext, requestId: number) {
  const response = await request.get("/api/notifications");
  expect(response.ok()).toBe(true);
  const notifications = await response.json() as ReturnAlert[];
  return notifications.filter(notification =>
    notification.requestId === requestId &&
    ["return_confirmed", "security_deposit_released"].includes(notification.type),
  );
}

test("a released deposit survives a failed return save and retries update the same alert", async ({ request }) => {
  test.setTimeout(240_000);
  const response = await request.post("/api/e2e/owner-return-fixture", {
    data: { depositHeld: true },
  });
  expect(response.ok()).toBe(true);
  const fixture = await response.json() as OwnerReturnFixture;
  try {
    await login(request, fixture.owner);
    const headers = await mutationHeaders(request);
    const failed = await request.post(`/api/requests/${fixture.requestId}/confirm-return`, {
      headers: { ...headers, "x-e2e-simulate-failure": "owner-return-finalization" },
      data: { conditionRating: 5, sameCondition: true },
    });
    expect(failed.status(), await failed.text()).toBe(503);
    expect(await failed.json()).toMatchObject({
      returnRecoveryPending: true,
      depositReleased: true,
    });
    const beforeRecovery = await countFixtureRecords(request, fixture);
    expect(beforeRecovery.reputationRewards).toBe(0);
    expect(beforeRecovery.shareCoinRewards).toBe(0);

    await login(request, fixture.borrower);
    const pending = await alertsFor(request, fixture.requestId);
    expect(pending).toHaveLength(1);
    expect(pending[0].message.toLowerCase()).toContain("pending");
    expect(pending[0].title).not.toBe("Return Confirmed");
    const pendingId = pending[0].id;

    await login(request, fixture.owner);
    const retryHeaders = await mutationHeaders(request);
    const retries = await Promise.all([1, 2].map(() =>
      request.post(`/api/requests/${fixture.requestId}/confirm-return`, {
        headers: retryHeaders,
        data: { conditionRating: 5, sameCondition: true },
      }),
    ));
    expect(retries.some(result => result.status() === 200)).toBe(true);
    for (const result of retries) expect([200, 503]).toContain(result.status());
    const completedCounts = await countFixtureRecords(request, fixture);
    expect(completedCounts.reputationRewards).toBeGreaterThan(0);

    const repeated = await request.post(`/api/requests/${fixture.requestId}/confirm-return`, {
      headers: retryHeaders,
      data: { conditionRating: 5, sameCondition: true },
    });
    expect(repeated.status(), await repeated.text()).toBe(200);
    expect(await countFixtureRecords(request, fixture)).toEqual(completedCounts);

    await login(request, fixture.borrower);
    const completed = await alertsFor(request, fixture.requestId);
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({
      id: pendingId,
      type: "return_confirmed",
      title: "Return Confirmed",
    });
    expect(completed[0].message).toContain("Temporary hold released.");
    expect(completed[0].message.toLowerCase()).not.toContain("pending");
  } finally {
    await cleanupOwnerReturnFixture(request, fixture.fixtureId);
  }
});

test("owner dialog observes recovered completion without replaying confirmation", async ({ page }) => {
  test.setTimeout(240_000);
  await suppressReturnReminderChecks(page);
  const response = await page.request.post("/api/e2e/owner-return-fixture", {
    data: { depositHeld: true },
  });
  expect(response.ok()).toBe(true);
  const fixture = await response.json() as OwnerReturnFixture;
  try {
    await login(page.request, fixture.owner);
    let browserConfirmations = 0;
    await page.route(`**/api/requests/${fixture.requestId}/confirm-return`, async route => {
      browserConfirmations++;
      await route.continue({
        headers: {
          ...route.request().headers(),
          "x-e2e-simulate-failure": "owner-return-finalization",
        },
      });
    });
    await page.goto("/requests");
    await page.getByRole("button", { name: "Open inbox" }).click();
    await page.getByRole("button", { name: /Ben Borrower/ }).click();
    await page.getByRole("button", { name: "Confirm return", exact: true }).last().click();
    const dialog = page.getByRole("dialog", { name: "Confirm Item Return" });
    await expect(dialog).toBeVisible();
    const pendingResponse = page.waitForResponse(result =>
      result.request().method() === "POST" &&
      result.url().endsWith(`/api/requests/${fixture.requestId}/confirm-return`),
    );
    await dialog.getByRole("button", { name: "Confirm Return" }).click();
    expect((await pendingResponse).status()).toBe(503);
    await expect(dialog.getByRole("status")).toContainText("being recovered");

    const recovered = await page.request.post(`/api/requests/${fixture.requestId}/confirm-return`, {
      headers: await mutationHeaders(page.request),
      data: { conditionRating: 5, sameCondition: true },
    });
    expect(recovered.status(), await recovered.text()).toBe(200);
    await expect(dialog).toBeHidden({ timeout: 15_000 });
    await expect(page.getByRole("dialog", { name: "Leave a review" })).toBeVisible();
    expect(browserConfirmations).toBe(1);
    await page.screenshot({ path: "test-results/return-recovery-completed.png" });
  } finally {
    await cleanupOwnerReturnFixture(page.request, fixture.fixtureId);
  }
});