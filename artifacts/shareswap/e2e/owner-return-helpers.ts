import { expect, type APIRequestContext, type Page } from "@playwright/test";

export type OwnerReturnFixture = {
  fixtureId: string;
  owner: { username: string; password: string };
  borrower: { username: string; password: string };
  requestId: number;
  itemId: number;
  userIds: number[];
};

export const emptyFixtureRecords = {
  users: 0, items: 0, requests: 0, shareCoinRewards: 0,
  reputationRewards: 0, achievements: 0, reviews: 0, notifications: 0,
};
export type FixtureRecordCounts = typeof emptyFixtureRecords;

export async function suppressReturnReminderChecks(page: Page) {
  await page.route("**/api/notifications/check-return-reminders", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ remindersCreated: 0 }),
    });
  });
}

export async function cleanupOwnerReturnFixture(
  request: APIRequestContext,
  fixtureId: string,
  options: { expectPostReturnActivity?: boolean } = {},
) {
  const response = await request.post("/api/e2e/owner-return-fixture/cleanup", {
    data: { fixtureId },
  });
  expect(response.ok()).toBe(true);
  const cleanup = await response.json() as {
    generated: FixtureRecordCounts; remaining: FixtureRecordCounts;
  };
  expect(cleanup.generated.users).toBe(2);
  expect(cleanup.generated.items).toBe(1);
  expect(cleanup.generated.requests).toBe(1);
  if (options.expectPostReturnActivity) expectPostReturnActivity(cleanup.generated);
  expect(cleanup.remaining).toEqual(emptyFixtureRecords);
}

export async function countFixtureRecords(
  request: APIRequestContext,
  fixture: OwnerReturnFixture,
): Promise<FixtureRecordCounts> {
  const response = await request.post("/api/e2e/owner-return-fixture/records", {
    data: {
      requestId: fixture.requestId,
      itemId: fixture.itemId,
      userIds: fixture.userIds,
    },
  });
  expect(response.ok()).toBe(true);
  return response.json();
}

export function expectPostReturnActivity(counts: FixtureRecordCounts) {
  expect(counts.users).toBe(2);
  expect(counts.items).toBe(1);
  expect(counts.requests).toBe(1);
  expect(counts.shareCoinRewards).toBeGreaterThan(0);
  expect(counts.reputationRewards).toBeGreaterThan(0);
  expect(counts.achievements).toBeGreaterThan(0);
  expect(counts.reviews).toBeGreaterThan(0);
  expect(counts.notifications).toBeGreaterThan(0);
}

export async function completeReturnWithReview(page: Page, fixture: OwnerReturnFixture) {
  const login = await page.request.post("/api/login", { data: fixture.owner });
  expect(login.ok()).toBe(true);
  await page.goto("/requests");
  await page.getByRole("button", { name: "Open inbox" }).click();
  await page.getByRole("button", { name: /Ben Borrower/ }).click();
  await page.getByRole("button", { name: "Confirm return", exact: true }).last().click();
  const returnDialog = page.getByRole("dialog", { name: "Confirm Item Return" });
  await expect(returnDialog).toBeVisible();
  const confirmed = page.waitForResponse((response) =>
    response.request().method() === "POST" &&
    response.url().endsWith(`/api/requests/${fixture.requestId}/confirm-return`),
  );
  await returnDialog.getByRole("button", { name: "Confirm Return" }).click();
  expect((await confirmed).ok()).toBe(true);
  const reviewDialog = page.getByRole("dialog", { name: "Leave a review" });
  await expect(reviewDialog).toBeVisible();
  await reviewDialog.locator("button").nth(4).click();
  const reviewed = page.waitForResponse((response) =>
    response.request().method() === "POST" &&
    /\/api\/users\/\d+\/reviews$/.test(new URL(response.url()).pathname),
  );
  await reviewDialog.getByRole("button", { name: "Submit review" }).click();
  expect((await reviewed).status()).toBe(201);
}