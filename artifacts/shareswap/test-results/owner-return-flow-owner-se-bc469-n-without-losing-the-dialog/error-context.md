# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: owner-return-flow.spec.ts >> owner sees a failed return confirmation without losing the dialog
- Location: e2e/owner-return-flow.spec.ts:151:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false
```

# Test source

```ts
  65  |     await expect(dialog).toBeVisible();
  66  |     await expect(page.getByText("Return failed", { exact: true })).toBeVisible();
  67  |     await expect(
  68  |       page.getByText("Return request could not be saved", { exact: true }),
  69  |     ).toBeVisible();
  70  |   } finally {
  71  |     await page.request.post("/api/e2e/owner-return-fixture/cleanup", {
  72  |       data: { fixtureId: fixture.fixtureId },
  73  |     });
  74  |   }
  75  | });
  76  | 
  77  | test("owner completes a return and saves the post-return review", async ({
  78  |   page,
  79  | }) => {
  80  |   test.setTimeout(60_000);
  81  |   const fixtureResponse = await page.request.post(
  82  |     "/api/e2e/owner-return-fixture",
  83  |   );
  84  |   expect(fixtureResponse.ok()).toBe(true);
  85  |   const fixture = (await fixtureResponse.json()) as OwnerReturnFixture;
  86  | 
  87  |   try {
  88  |     const loginResponse = await page.request.post("/api/login", {
  89  |       data: fixture.owner,
  90  |     });
  91  |     expect(loginResponse.ok()).toBe(true);
  92  | 
  93  |     await page.goto("/requests");
  94  |     await page.getByRole("button", { name: "Open inbox" }).click();
  95  |     await page.getByRole("button", { name: /Ben Borrower/ }).click();
  96  |     await page
  97  |       .getByRole("button", { name: "Confirm return", exact: true })
  98  |       .last()
  99  |       .click();
  100 | 
  101 |     const returnDialog = page.getByRole("dialog", {
  102 |       name: "Confirm Item Return",
  103 |     });
  104 |     await expect(returnDialog).toBeVisible();
  105 | 
  106 |     const confirmationResponse = page.waitForResponse(
  107 |       (response) =>
  108 |         response.request().method() === "POST" &&
  109 |         response.url().endsWith(
  110 |           `/api/requests/${fixture.requestId}/confirm-return`,
  111 |         ),
  112 |     );
  113 |     const requestsRefresh = page.waitForResponse(
  114 |       (response) =>
  115 |         response.request().method() === "GET" &&
  116 |         response.url().includes("/api/requests") &&
  117 |         response.ok(),
  118 |     );
  119 |     const inboxRefresh = page.waitForResponse(
  120 |       (response) =>
  121 |         response.request().method() === "GET" &&
  122 |         response.url().includes("/api/inbox") &&
  123 |         response.ok(),
  124 |     );
  125 | 
  126 |     await returnDialog.getByRole("button", { name: "Confirm Return" }).click();
  127 | 
  128 |     const [response] = await Promise.all([
  129 |       confirmationResponse,
  130 |       requestsRefresh,
  131 |       inboxRefresh,
  132 |     ]);
  133 |     expect(response.ok()).toBe(true);
  134 | 
  135 |     await expect(returnDialog).toBeHidden();
  136 |     await expect(
  137 |       page.getByRole("dialog", { name: "Leave a review" }),
  138 |     ).toBeVisible();
  139 |     await expect(
  140 |       page.getByRole("heading", {
  141 |         name: "How was your experience with Ben?",
  142 |       }),
  143 |     ).toBeVisible();
  144 | 
  145 |     const reviewDialog = page.getByRole("dialog", { name: "Leave a review" });
  146 |     const reviewResponse = page.waitForResponse(
  147 |       (response) =>
  148 |         response.request().method() === "POST" &&
  149 |         /\/api\/users\/\d+\/reviews$/.test(new URL(response.url()).pathname),
  150 |     );
  151 |     const reviewedRequestsRefresh = page.waitForResponse(
  152 |       (response) =>
  153 |         response.request().method() === "GET" &&
  154 |         response.url().includes("/api/requests") &&
  155 |         response.ok(),
  156 |     );
  157 | 
  158 |     await reviewDialog.locator("button").nth(4).click();
  159 |     await reviewDialog.getByRole("button", { name: "Submit review" }).click();
  160 | 
  161 |     const [savedReview] = await Promise.all([
  162 |       reviewResponse,
  163 |       reviewedRequestsRefresh,
  164 |     ]);
> 165 |     expect(savedReview.status()).toBe(201);
      |                                ^ Error: expect(received).toBe(expected) // Object.is equality
  166 |     await expect(reviewDialog).toBeHidden();
  167 | 
  168 |     const reloadedRequestsResponse = await page.request.get("/api/requests");
  169 |     expect(reloadedRequestsResponse.ok()).toBe(true);
  170 |     const reloadedRequests = (await reloadedRequestsResponse.json()) as Array<{
  171 |       id: number;
  172 |       reviewedByCurrentUser: boolean;
  173 |     }>;
  174 |     expect(
  175 |       reloadedRequests.find((request) => request.id === fixture.requestId)
  176 |         ?.reviewedByCurrentUser,
  177 |     ).toBe(true);
  178 |   } finally {
  179 |     await page.request.post("/api/e2e/owner-return-fixture/cleanup", {
  180 |       data: { fixtureId: fixture.fixtureId },
  181 |     });
  182 |   }
  183 | });
  184 | 
  185 | test("owner sees a failed return confirmation without losing the dialog", async ({
  186 |   page,
  187 | }) => {
  188 |   test.setTimeout(60_000);
  189 |   const fixtureResponse = await page.request.post(
  190 |     "/api/e2e/owner-return-fixture",
  191 |   );
  192 |   expect(fixtureResponse.ok()).toBe(true);
  193 |   const fixture = (await fixtureResponse.json()) as OwnerReturnFixture;
  194 | 
  195 |   try {
  196 |     const loginResponse = await page.request.post("/api/login", {
  197 |       data: fixture.owner,
  198 |     });
  199 |     expect(loginResponse.ok()).toBe(true);
  200 | 
  201 |     await page.route(
  202 |       `**/api/requests/${fixture.requestId}/confirm-return`,
  203 |       async (route) => {
  204 |         await route.continue({
  205 |           headers: {
  206 |             ...route.request().headers(),
  207 |             "x-e2e-simulate-failure": "owner-return-confirmation",
  208 |           },
  209 |         });
  210 |       },
  211 |     );
  212 | 
  213 |     await page.goto("/requests");
  214 |     await page.getByRole("button", { name: "Open inbox" }).click();
  215 |     await page.getByRole("button", { name: /Ben Borrower/ }).click();
  216 |     await page
  217 |       .getByRole("button", { name: "Confirm return", exact: true })
  218 |       .last()
  219 |       .click();
  220 | 
  221 |     const dialog = page.getByRole("dialog", { name: "Confirm Item Return" });
  222 |     await expect(dialog).toBeVisible();
  223 | 
  224 |     const confirmationRequest = page.waitForRequest(
  225 |       (request) =>
  226 |         request.method() === "POST" &&
  227 |         request.url().endsWith(
  228 |           `/api/requests/${fixture.requestId}/confirm-return`,
  229 |         ),
  230 |     );
  231 |     const confirmationResponse = page.waitForResponse(
  232 |       (response) =>
  233 |         response.request().method() === "POST" &&
  234 |         response.url().endsWith(
  235 |           `/api/requests/${fixture.requestId}/confirm-return`,
  236 |         ),
  237 |     );
  238 | 
  239 |     await dialog.getByRole("button", { name: "Confirm Return" }).click();
  240 | 
  241 |     const [request, response] = await Promise.all([
  242 |       confirmationRequest,
  243 |       confirmationResponse,
  244 |     ]);
  245 |     expect(request.headers()["x-e2e-simulate-failure"]).toBe(
  246 |       "owner-return-confirmation",
  247 |     );
  248 |     expect(response.status()).toBe(500);
  249 | 
  250 |     await expect(dialog).toBeVisible();
  251 |     await expect(
  252 |       page.getByText("Confirmation failed", { exact: true }),
  253 |     ).toBeVisible();
  254 |     await expect(
  255 |       page.getByText("Return could not be saved", { exact: true }),
  256 |     ).toBeVisible();
  257 |   } finally {
  258 |     await page.request.post("/api/e2e/owner-return-fixture/cleanup", {
  259 |       data: { fixtureId: fixture.fixtureId },
  260 |     });
  261 |   }
  262 | });
```