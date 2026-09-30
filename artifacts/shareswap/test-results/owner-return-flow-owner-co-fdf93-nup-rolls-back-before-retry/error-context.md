# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: owner-return-flow.spec.ts >> owner completes a return and failed fixture cleanup rolls back before retry
- Location: e2e/owner-return-flow.spec.ts:232:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false
```

# Test source

```ts
  1   | import {
  2   |   expect,
  3   |   test,
  4   |   type APIRequestContext,
  5   |   type Page,
  6   | } from "@playwright/test";
  7   | 
  8   | // These tests share one E2E API fixture registry and intentionally inject
  9   | // cleanup failures; a parallel setup can observe another test's injected failure.
  10  | test.describe.configure({ mode: "serial" });
  11  | 
  12  | type OwnerReturnFixture = {
  13  |   fixtureId: string;
  14  |   owner: { username: string; password: string };
  15  |   borrower: { username: string; password: string };
  16  |   requestId: number;
  17  |   itemId: number;
  18  |   userIds: number[];
  19  | };
  20  | 
  21  | type FixtureRecordCounts = {
  22  |   users: number;
  23  |   items: number;
  24  |   requests: number;
  25  |   shareCoinRewards: number;
  26  |   reputationRewards: number;
  27  |   achievements: number;
  28  |   reviews: number;
  29  |   notifications: number;
  30  | };
  31  | 
  32  | async function suppressReturnReminderChecks(page: Page) {
  33  |   await page.route("**/api/notifications/check-return-reminders", async (route) => {
  34  |     await route.fulfill({
  35  |       status: 200,
  36  |       contentType: "application/json",
  37  |       body: JSON.stringify({ remindersCreated: 0 }),
  38  |     });
  39  |   });
  40  | }
  41  | 
  42  | async function cleanupOwnerReturnFixture(
  43  |   request: APIRequestContext,
  44  |   fixtureId: string,
  45  |   options: { expectPostReturnActivity?: boolean } = {},
  46  | ) {
  47  |   const cleanupResponse = await request.post(
  48  |     "/api/e2e/owner-return-fixture/cleanup",
> 49  |     { data: { fixtureId } },
      |                                ^ Error: expect(received).toBe(expected) // Object.is equality
  50  |   );
  51  |   expect(cleanupResponse.ok()).toBe(true);
  52  |   const cleanup = (await cleanupResponse.json()) as {
  53  |     generated: FixtureRecordCounts;
  54  |     remaining: FixtureRecordCounts;
  55  |   };
  56  | 
  57  |   expect(cleanup.generated.users).toBe(2);
  58  |   expect(cleanup.generated.items).toBe(1);
  59  |   expect(cleanup.generated.requests).toBe(1);
  60  | 
  61  |   if (options.expectPostReturnActivity) {
  62  |     expect(cleanup.generated.shareCoinRewards).toBeGreaterThan(0);
  63  |     expect(cleanup.generated.reputationRewards).toBeGreaterThan(0);
  64  |     expect(cleanup.generated.achievements).toBeGreaterThan(0);
  65  |     expect(cleanup.generated.reviews).toBeGreaterThan(0);
  66  |     expect(cleanup.generated.notifications).toBeGreaterThan(0);
  67  |   }
  68  | 
  69  |   expect(cleanup.remaining).toEqual({
  70  |     users: 0,
  71  |     items: 0,
  72  |     requests: 0,
  73  |     shareCoinRewards: 0,
  74  |     reputationRewards: 0,
  75  |     achievements: 0,
  76  |     reviews: 0,
  77  |     notifications: 0,
  78  |   });
  79  | }
  80  | 
  81  | async function countFixtureRecords(
  82  |   request: APIRequestContext,
  83  |   fixture: OwnerReturnFixture,
  84  | ): Promise<FixtureRecordCounts> {
  85  |   const response = await request.post("/api/e2e/owner-return-fixture/records", {
  86  |     data: {
  87  |       requestId: fixture.requestId,
  88  |       itemId: fixture.itemId,
  89  |       userIds: fixture.userIds,
  90  |     },
  91  |   });
  92  |   expect(response.ok()).toBe(true);
  93  |   return response.json() as Promise<FixtureRecordCounts>;
  94  | }
  95  | 
  96  | function expectPostReturnActivity(counts: FixtureRecordCounts) {
  97  |   expect(counts.users).toBe(2);
  98  |   expect(counts.items).toBe(1);
  99  |   expect(counts.requests).toBe(1);
  100 |   expect(counts.shareCoinRewards).toBeGreaterThan(0);
  101 |   expect(counts.reputationRewards).toBeGreaterThan(0);
  102 |   expect(counts.achievements).toBeGreaterThan(0);
  103 |   expect(counts.reviews).toBeGreaterThan(0);
  104 |   expect(counts.notifications).toBeGreaterThan(0);
  105 | }
  106 | 
  107 | async function completeReturnWithReview(page: Page, fixture: OwnerReturnFixture) {
  108 |   const login = await page.request.post("/api/login", { data: fixture.owner });
  109 |   expect(login.ok()).toBe(true);
  110 |   await page.goto("/requests");
  111 |   await page.getByRole("button", { name: "Open inbox" }).click();
  112 |   await page.getByRole("button", { name: /Ben Borrower/ }).click();
  113 |   await page.getByRole("button", { name: "Confirm return", exact: true }).last().click();
  114 |   const returnDialog = page.getByRole("dialog", { name: "Confirm Item Return" });
  115 |   await expect(returnDialog).toBeVisible();
  116 |   const confirmed = page.waitForResponse((response) =>
  117 |     response.request().method() === "POST" &&
  118 |     response.url().endsWith(`/api/requests/${fixture.requestId}/confirm-return`),
  119 |   );
  120 |   await returnDialog.getByRole("button", { name: "Confirm Return" }).click();
  121 |   expect((await confirmed).ok()).toBe(true);
  122 |   const reviewDialog = page.getByRole("dialog", { name: "Leave a review" });
  123 |   await expect(reviewDialog).toBeVisible();
  124 |   await reviewDialog.locator("button").nth(4).click();
  125 |   const reviewed = page.waitForResponse((response) =>
  126 |     response.request().method() === "POST" &&
  127 |     /\/api\/users\/\d+\/reviews$/.test(new URL(response.url()).pathname),
  128 |   );
  129 |   await reviewDialog.getByRole("button", { name: "Submit review" }).click();
  130 |   expect((await reviewed).status()).toBe(201);
  131 | }
  132 | 
  133 | test("failed fixture setup rolls back every inserted record", async ({
  134 |   request,
  135 | }) => {
  136 |   const fixtureResponse = await request.post(
  137 |     "/api/e2e/owner-return-fixture",
  138 |     {
  139 |       headers: {
  140 |         "x-e2e-simulate-failure": "owner-return-fixture-setup",
  141 |       },
  142 |     },
  143 |   );
  144 | 
  145 |   expect(fixtureResponse.status()).toBe(500);
  146 |   const failure = (await fixtureResponse.json()) as {
  147 |     fixtureId: string;
  148 |     remaining: FixtureRecordCounts;
  149 |   };
```