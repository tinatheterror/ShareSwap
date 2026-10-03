import { expect, test } from "@playwright/test";
import { pool } from "../../../lib/db/src/index";
import { awardAchievementOnce } from "../../api-server/src/achievement-awards";
import {
  cleanupOwnerReturnFixture,
  suppressReturnReminderChecks,
  type OwnerReturnFixture,
} from "./owner-return-helpers";

test("a real badge award refreshes a mounted wallet and the API preserves the reward in an old-style notice", async ({ page }) => {
  test.setTimeout(90_000);
  await suppressReturnReminderChecks(page);
  const setup = await page.request.post("/api/e2e/owner-return-fixture", { data: {} });
  expect(setup.ok()).toBe(true);
  const fixture = await setup.json() as OwnerReturnFixture;
  try {
    // This test uses the fixture only for isolated accounts, not a return.
    // Do not let the live development deadline scheduler act on its old loan
    // dates or insert request-linked activity while fixture cleanup is running.
    await pool.query("UPDATE item_requests SET status = 'CANCELLED' WHERE id = $1", [fixture.requestId]);
    const login = await page.request.post("/api/login", { data: fixture.owner });
    expect(login.ok()).toBe(true);
    const account = await login.json() as { id: number; shareCoins: string };
    const initialCoins = Number(account.shareCoins);
    const initialNotifications = page.waitForResponse(response =>
      response.request().method() === "GET" && new URL(response.url()).pathname === "/api/notifications",
    );
    await page.goto("/wallet");
    expect((await initialNotifications).ok()).toBe(true);
    await expect(page.getByRole("heading", { name: "ShareCoin Wallet" })).toBeVisible();
    await expect(page.locator("main").getByText(`${Math.round(initialCoins)} ShareCoins`, { exact: true })).toBeVisible();
    // Wait for the bell's first notification response before awarding a badge,
    // so this verifies a subsequent poll, not a fresh login/reload.
    const { rows: [badge] } = await pool.query("SELECT id FROM achievements WHERE name = $1 LIMIT 1", ["rising_star"]);
    expect(badge).toBeTruthy();
    const description = "Completed 20 exchanges — an exchange veteran neighbours rely on.";
    expect(await awardAchievementOnce({
      userId: account.id, achievementId: badge.id, title: "Rising Star", description,
    })).toBe(true);
    // Preserve a real awarded credit but exercise the historical saved copy
    // that previously lost its reward in the GET /api/notifications shortener.
    await pool.query(
      "UPDATE notifications SET message = $1 WHERE user_id = $2 AND type = 'badge_earned'",
      [`${description} +1 ShareCoin awarded!`, account.id],
    );
    const response = await page.request.get("/api/notifications");
    expect(response.ok()).toBe(true);
    const alerts = await response.json() as { type: string; message: string }[];
    expect(alerts.find(alert => alert.type === "badge_earned")?.message).toMatch(/^\+1 ShareCoin earned\./);
    await expect(page.locator("main").getByText(`${Math.round(initialCoins + 1)} ShareCoins`, { exact: true })).toBeVisible({ timeout: 40_000 });
    await expect(page.getByText("Badge unlocked: Rising Star", { exact: true })).toBeVisible();
    await page.goto("/notifications");
    await expect(page.getByText("🏅 Badge Unlocked: Rising Star", { exact: true })).toBeVisible();
    await expect(page.getByText(/^\+1 ShareCoin earned\./).first()).toBeVisible();
    await page.screenshot({ path: "test-results/badge-reward-visible.png", fullPage: true });
    const balanceResponse = await page.request.get("/api/user");
    expect(Number((await balanceResponse.json()).shareCoins)).toBe(initialCoins + 1);
  } finally {
    await cleanupOwnerReturnFixture(page.request, fixture.fixtureId);
  }
});