import { expect, test } from "@playwright/test";

test("game starts", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("canvas#game")).toBeVisible();
});
