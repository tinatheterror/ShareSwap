import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

test.describe.configure({ mode: "parallel" });

type OwnerReturnFixture = {
  fixtureId: string;
  owner: { username: string; password: string };
  borrower: { username: string; password: string };
  requestId: number;
};

type FixtureRecordCounts = {
  users: number;
  items: number;
  requests: number;
  shareCoinRewards: number;
  reputationRewards: number;
  achievements: number;
  reviews: number;
  notifications: number;
};

async function suppressReturnReminderChecks(page: Page) {
  await page.route("**/api/notifications/check-return-reminders", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ remindersCreated: 0 }),
    });
  });
}

async function cleanupOwnerReturnFixture(
  request: APIRequestContext,
  fixtureId: string,
  options: { expectPostReturnActivity?: boolean } = {},
) {
  const cleanupResponse = await request.post(
    "/api/e2e/owner-return-fixture/cleanup",
    { data: { fixtureId } },
  );
  expect(cleanupResponse.ok()).toBe(true);
  const cleanup = (await cleanupResponse.json()) as {
    generated: FixtureRecordCounts;
    remaining: FixtureRecordCounts;
  };

  expect(cleanup.generated.users).toBe(2);
  expect(cleanup.generated.items).toBe(1);
  expect(cleanup.generated.requests).toBe(1);

  if (options.expectPostReturnActivity) {
    expect(cleanup.generated.shareCoinRewards).toBeGreaterThan(0);
    expect(cleanup.generated.reputationRewards).toBeGreaterThan(0);
    expect(cleanup.generated.achievements).toBeGreaterThan(0);
    expect(cleanup.generated.reviews).toBeGreaterThan(0);
    expect(cleanup.generated.notifications).toBeGreaterThan(0);
  }

  expect(cleanup.remaining).toEqual({
    users: 0,
    items: 0,
    requests: 0,
    shareCoinRewards: 0,
    reputationRewards: 0,
    achievements: 0,
    reviews: 0,
    notifications: 0,
  });
}

test("failed fixture setup rolls back every inserted record", async ({
  request,
}) => {
  const fixtureResponse = await request.post(
    "/api/e2e/owner-return-fixture",
    {
      headers: {
        "x-e2e-simulate-failure": "owner-return-fixture-setup",
      },
    },
  );

  expect(fixtureResponse.status()).toBe(500);
  const failure = (await fixtureResponse.json()) as {
    fixtureId: string;
    remaining: FixtureRecordCounts;
  };
  expect(failure.fixtureId).toMatch(/^[a-f0-9]{16}$/);
  expect(failure.remaining).toEqual({
    users: 0,
    items: 0,
    requests: 0,
    shareCoinRewards: 0,
    reputationRewards: 0,
    achievements: 0,
    reviews: 0,
    notifications: 0,
  });
});

test("borrower sees a failed return request without losing the dialog", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await suppressReturnReminderChecks(page);
  const fixtureResponse = await page.request.post(
    "/api/e2e/owner-return-fixture",
    { data: { flow: "borrower-return" } },
  );
  expect(fixtureResponse.ok()).toBe(true);
  const fixture = (await fixtureResponse.json()) as OwnerReturnFixture;

  try {
    const loginResponse = await page.request.post("/api/login", {
      data: fixture.borrower,
    });
    expect(loginResponse.ok()).toBe(true);

    await page.route(`**/api/requests/${fixture.requestId}/return`, async (route) => {
      await route.continue({
        headers: {
          ...route.request().headers(),
          "x-e2e-simulate-failure": "borrower-return-request",
        },
      });
    });

    await page.goto("/requests");
    await page.getByRole("button", { name: "Open inbox" }).click();
    await page.getByRole("button", { name: /Olivia Owner/ }).click();
    await page.getByRole("button", { name: "Return item", exact: true }).last().click();

    const dialog = page.getByRole("dialog", { name: "Return Item" });
    await expect(dialog).toBeVisible();

    const returnRequest = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        request.url().endsWith(`/api/requests/${fixture.requestId}/return`),
    );
    const returnResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith(`/api/requests/${fixture.requestId}/return`),
    );

    await dialog.getByRole("button", { name: "Return Item" }).click();

    const [request, response] = await Promise.all([returnRequest, returnResponse]);
    expect(request.headers()["x-e2e-simulate-failure"]).toBe(
      "borrower-return-request",
    );
    expect(response.status()).toBe(500);

    await expect(dialog).toBeVisible();
    await expect(page.getByText("Return failed", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Return request could not be saved", { exact: true }),
    ).toBeVisible();
  } finally {
    await cleanupOwnerReturnFixture(page.request, fixture.fixtureId);
  }
});

test("owner completes a return and failed fixture cleanup rolls back before retry", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await suppressReturnReminderChecks(page);
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

    await page.goto("/requests");
    await page.getByRole("button", { name: "Open inbox" }).click();
    await page.getByRole("button", { name: /Ben Borrower/ }).click();
    await page
      .getByRole("button", { name: "Confirm return", exact: true })
      .last()
      .click();

    const returnDialog = page.getByRole("dialog", {
      name: "Confirm Item Return",
    });
    await expect(returnDialog).toBeVisible();

    const confirmationResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith(
          `/api/requests/${fixture.requestId}/confirm-return`,
        ),
    );
    const requestsRefresh = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        response.url().includes("/api/requests") &&
        response.ok(),
    );
    const inboxRefresh = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        response.url().includes("/api/inbox") &&
        response.ok(),
    );

    await returnDialog.getByRole("button", { name: "Confirm Return" }).click();

    const [response] = await Promise.all([
      confirmationResponse,
      requestsRefresh,
      inboxRefresh,
    ]);
    expect(response.ok()).toBe(true);

    await expect(returnDialog).toBeHidden();
    await expect(
      page.getByRole("dialog", { name: "Leave a review" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: "How was your experience with Ben?",
      }),
    ).toBeVisible();

    const reviewDialog = page.getByRole("dialog", { name: "Leave a review" });
    const reviewResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        /\/api\/users\/\d+\/reviews$/.test(new URL(response.url()).pathname),
    );
    const reviewedRequestsRefresh = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        response.url().includes("/api/requests") &&
        response.ok(),
    );

    await reviewDialog.locator("button").nth(4).click();
    await reviewDialog.getByRole("button", { name: "Submit review" }).click();

    const [savedReview] = await Promise.all([
      reviewResponse,
      reviewedRequestsRefresh,
    ]);
    expect(savedReview.status()).toBe(201);
    await expect(reviewDialog).toBeHidden();

    const reloadedRequestsResponse = await page.request.get("/api/requests");
    expect(reloadedRequestsResponse.ok()).toBe(true);
    const reloadedRequests = (await reloadedRequestsResponse.json()) as Array<{
      id: number;
      reviewedByCurrentUser: boolean;
    }>;
    expect(
      reloadedRequests.find((request) => request.id === fixture.requestId)
        ?.reviewedByCurrentUser,
    ).toBe(true);

    const failedCleanupResponse = await page.request.post(
      "/api/e2e/owner-return-fixture/cleanup",
      {
        data: { fixtureId: fixture.fixtureId },
        headers: {
          "x-e2e-simulate-failure": "owner-return-fixture-cleanup",
        },
      },
    );
    expect(failedCleanupResponse.status()).toBe(500);
    const failedCleanup = (await failedCleanupResponse.json()) as {
      generated: FixtureRecordCounts;
      remaining: FixtureRecordCounts;
    };
    expect(failedCleanup.generated.users).toBe(2);
    expect(failedCleanup.generated.items).toBe(1);
    expect(failedCleanup.generated.requests).toBe(1);
    expect(failedCleanup.generated.shareCoinRewards).toBeGreaterThan(0);
    expect(failedCleanup.generated.reputationRewards).toBeGreaterThan(0);
    expect(failedCleanup.generated.achievements).toBeGreaterThan(0);
    expect(failedCleanup.generated.reviews).toBeGreaterThan(0);
    expect(failedCleanup.generated.notifications).toBeGreaterThan(0);
    expect(failedCleanup.remaining).toEqual(failedCleanup.generated);
  } finally {
    await cleanupOwnerReturnFixture(page.request, fixture.fixtureId, {
      expectPostReturnActivity: true,
    });
  }
});

test("owner sees a failed return confirmation without losing the dialog", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await suppressReturnReminderChecks(page);
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
    await cleanupOwnerReturnFixture(page.request, fixture.fixtureId);
  }
});