import { test, expect } from "@playwright/test";

// Customer routes aren't protected by middleware (see
// lib/customer-auth/config.ts's own comment on why) -- each page checks
// auth() itself instead. This proves that check actually runs for every
// protected page, not just /account itself.
test.describe("account route isolation", () => {
  test("/account shows a sign-in prompt, not an error, when signed out", async ({ page }) => {
    const response = await page.goto("/account");
    expect(response?.ok()).toBe(true);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
  });

  test("unauthenticated /account/orders redirects to /account", async ({ page }) => {
    await page.goto("/account/orders");
    await expect(page).toHaveURL("/account");
  });

  test("unauthenticated /account/addresses redirects to /account", async ({ page }) => {
    await page.goto("/account/addresses");
    await expect(page).toHaveURL("/account");
  });
});
