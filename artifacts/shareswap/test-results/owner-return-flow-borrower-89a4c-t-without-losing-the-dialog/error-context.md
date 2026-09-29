# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: owner-return-flow.spec.ts >> borrower sees a failed return request without losing the dialog
- Location: e2e/owner-return-flow.spec.ts:166:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false
```

# Test source

```ts
  75  | }
  76  | 
  77  | test("failed fixture setup rolls back every inserted record", async ({
  78  |   request,
  79  | }) => {
  80  |   const fixtureResponse = await request.post(
  81  |     "/api/e2e/owner-return-fixture",
  82  |     {
  83  |       headers: {
  84  |         "x-e2e-simulate-failure": "owner-return-fixture-setup",
  85  |       },
  86  |     },
  87  |   );
  88  | 
  89  |   expect(fixtureResponse.status()).toBe(500);
  90  |   const failure = (await fixtureResponse.json()) as {
  91  |     fixtureId: string;
  92  |     remaining: FixtureRecordCounts;
  93  |   };
  94  |   expect(failure.fixtureId).toMatch(/^[a-f0-9]{16}$/);
  95  |   expect(failure.remaining).toEqual({
  96  |     users: 0,
  97  |     items: 0,
  98  |     requests: 0,
  99  |     shareCoinRewards: 0,
  100 |     reputationRewards: 0,
  101 |     achievements: 0,
  102 |     reviews: 0,
  103 |     notifications: 0,
  104 |   });
  105 | });
  106 | 
  107 | test("failed orphan cleanup rolls back and the next setup retries without deleting active fixtures", async ({
  108 |   request,
  109 | }) => {
  110 |   const activeResponses = await Promise.all([
  111 |     request.post("/api/e2e/owner-return-fixture"),
  112 |     request.post("/api/e2e/owner-return-fixture"),
  113 |   ]);
  114 |   for (const response of activeResponses) expect(response.ok()).toBe(true);
  115 |   const active = await Promise.all(
  116 |     activeResponses.map((response) => response.json() as Promise<OwnerReturnFixture>),
  117 |   );
  118 |   let retried: OwnerReturnFixture | undefined;
  119 | 
  120 |   try {
  121 |     // Deliberately leave one fixture untracked to represent a previous interrupted run.
  122 |     const orphanResponse = await request.post("/api/e2e/owner-return-fixture", {
  123 |       headers: { "x-e2e-simulate-failure": "owner-return-fixture-orphan" },
  124 |     });
  125 |     expect(orphanResponse.ok()).toBe(true);
  126 |     const orphan = (await orphanResponse.json()) as OwnerReturnFixture;
  127 | 
  128 |     const failedCleanup = await request.post("/api/e2e/owner-return-fixture", {
  129 |       headers: { "x-e2e-simulate-failure": "owner-return-orphan-cleanup" },
  130 |     });
  131 |     expect(failedCleanup.status()).toBe(500);
  132 | 
  133 |     // Deletions inside the failed transaction must have rolled back.
  134 |     const orphanLogin = await request.post("/api/login", {
  135 |       data: orphan.owner,
  136 |     });
  137 |     expect(orphanLogin.ok()).toBe(true);
  138 | 
  139 |     const retryResponse = await request.post("/api/e2e/owner-return-fixture");
  140 |     expect(retryResponse.ok()).toBe(true);
  141 |     retried = (await retryResponse.json()) as OwnerReturnFixture;
  142 | 
  143 |     const removedOrphanLogin = await request.post("/api/login", {
  144 |       data: orphan.owner,
  145 |     });
  146 |     expect(removedOrphanLogin.ok()).toBe(false);
  147 |     for (const fixture of active) {
  148 |       const activeLogin = await request.post("/api/login", {
  149 |         data: fixture.owner,
  150 |       });
  151 |       expect(activeLogin.ok()).toBe(true);
  152 |     }
  153 |   } finally {
  154 |     // If an assertion fails before retry, a later setup still clears the orphan.
  155 |     if (!retried) {
  156 |       const recovery = await request.post("/api/e2e/owner-return-fixture");
  157 |       if (recovery.ok()) retried = (await recovery.json()) as OwnerReturnFixture;
  158 |     }
  159 |     if (retried) await cleanupOwnerReturnFixture(request, retried.fixtureId);
  160 |     for (const fixture of active) {
  161 |       await cleanupOwnerReturnFixture(request, fixture.fixtureId);
  162 |     }
  163 |   }
  164 | });
  165 | 
  166 | test("borrower sees a failed return request without losing the dialog", async ({
  167 |   page,
  168 | }) => {
  169 |   test.setTimeout(60_000);
  170 |   await suppressReturnReminderChecks(page);
  171 |   const fixtureResponse = await page.request.post(
  172 |     "/api/e2e/owner-return-fixture",
  173 |     { data: { flow: "borrower-return" } },
  174 |   );
> 175 |   expect(fixtureResponse.ok()).toBe(true);
      |                                ^ Error: expect(received).toBe(expected) // Object.is equality
  176 |   const fixture = (await fixtureResponse.json()) as OwnerReturnFixture;
  177 | 
  178 |   try {
  179 |     const loginResponse = await page.request.post("/api/login", {
  180 |       data: fixture.borrower,
  181 |     });
  182 |     expect(loginResponse.ok()).toBe(true);
  183 | 
  184 |     await page.route(`**/api/requests/${fixture.requestId}/return`, async (route) => {
  185 |       await route.continue({
  186 |         headers: {
  187 |           ...route.request().headers(),
  188 |           "x-e2e-simulate-failure": "borrower-return-request",
  189 |         },
  190 |       });
  191 |     });
  192 | 
  193 |     await page.goto("/requests");
  194 |     await page.getByRole("button", { name: "Open inbox" }).click();
  195 |     await page.getByRole("button", { name: /Olivia Owner/ }).click();
  196 |     await page.getByRole("button", { name: "Return item", exact: true }).last().click();
  197 | 
  198 |     const dialog = page.getByRole("dialog", { name: "Return Item" });
  199 |     await expect(dialog).toBeVisible();
  200 | 
  201 |     const returnRequest = page.waitForRequest(
  202 |       (request) =>
  203 |         request.method() === "POST" &&
  204 |         request.url().endsWith(`/api/requests/${fixture.requestId}/return`),
  205 |     );
  206 |     const returnResponse = page.waitForResponse(
  207 |       (response) =>
  208 |         response.request().method() === "POST" &&
  209 |         response.url().endsWith(`/api/requests/${fixture.requestId}/return`),
  210 |     );
  211 | 
  212 |     await dialog.getByRole("button", { name: "Return Item" }).click();
  213 | 
  214 |     const [request, response] = await Promise.all([returnRequest, returnResponse]);
  215 |     expect(request.headers()["x-e2e-simulate-failure"]).toBe(
  216 |       "borrower-return-request",
  217 |     );
  218 |     expect(response.status()).toBe(500);
  219 | 
  220 |     await expect(dialog).toBeVisible();
  221 |     await expect(page.getByText("Return failed", { exact: true })).toBeVisible();
  222 |     await expect(
  223 |       page.getByText("Return request could not be saved", { exact: true }),
  224 |     ).toBeVisible();
  225 |   } finally {
  226 |     await cleanupOwnerReturnFixture(page.request, fixture.fixtureId);
  227 |   }
  228 | });
  229 | 
  230 | test("owner completes a return and failed fixture cleanup rolls back before retry", async ({
  231 |   page,
  232 | }) => {
  233 |   test.setTimeout(60_000);
  234 |   await suppressReturnReminderChecks(page);
  235 |   const fixtureResponse = await page.request.post(
  236 |     "/api/e2e/owner-return-fixture",
  237 |   );
  238 |   expect(fixtureResponse.ok()).toBe(true);
  239 |   const fixture = (await fixtureResponse.json()) as OwnerReturnFixture;
  240 | 
  241 |   try {
  242 |     const loginResponse = await page.request.post("/api/login", {
  243 |       data: fixture.owner,
  244 |     });
  245 |     expect(loginResponse.ok()).toBe(true);
  246 | 
  247 |     await page.goto("/requests");
  248 |     await page.getByRole("button", { name: "Open inbox" }).click();
  249 |     await page.getByRole("button", { name: /Ben Borrower/ }).click();
  250 |     await page
  251 |       .getByRole("button", { name: "Confirm return", exact: true })
  252 |       .last()
  253 |       .click();
  254 | 
  255 |     const returnDialog = page.getByRole("dialog", {
  256 |       name: "Confirm Item Return",
  257 |     });
  258 |     await expect(returnDialog).toBeVisible();
  259 | 
  260 |     const confirmationResponse = page.waitForResponse(
  261 |       (response) =>
  262 |         response.request().method() === "POST" &&
  263 |         response.url().endsWith(
  264 |           `/api/requests/${fixture.requestId}/confirm-return`,
  265 |         ),
  266 |     );
  267 |     const requestsRefresh = page.waitForResponse(
  268 |       (response) =>
  269 |         response.request().method() === "GET" &&
  270 |         response.url().includes("/api/requests") &&
  271 |         response.ok(),
  272 |     );
  273 |     const inboxRefresh = page.waitForResponse(
  274 |       (response) =>
  275 |         response.request().method() === "GET" &&
```