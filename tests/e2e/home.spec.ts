import { test, expect } from "@playwright/test";

test("home page loads and shows the store name", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "1st Tees" })).toBeVisible();
});
