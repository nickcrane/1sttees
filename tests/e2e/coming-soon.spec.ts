import { test, expect } from "@playwright/test";

// The redirect gate itself (COMING_SOON_MODE=true sending every public
// route here) isn't exercised by this suite -- the shared webServer runs
// with the flag unset/false for the rest of the e2e suite, and flipping
// it here would take down every other storefront test. That behaviour is
// verified live against the deployed environment instead (see
// docs/deployment.md); this file covers the page's own functionality,
// which works regardless of the flag.
test.describe("Coming Soon page", () => {
  test("renders and accepts a waitlist signup", async ({ page }) => {
    const email = `waitlist-${Date.now()}@example.com`;

    await page.goto("/coming-soon");
    await expect(page.getByRole("heading", { name: "1st Tees" })).toBeVisible();

    await page.getByLabel("Email address").fill(email);
    await page.getByRole("button", { name: "Notify me" }).click();

    await expect(page.getByText("You're on the list")).toBeVisible();
  });

  test("resubmitting the same email is a silent success, not an error", async ({ page }) => {
    const email = `waitlist-repeat-${Date.now()}@example.com`;

    await page.goto("/coming-soon");
    await page.getByLabel("Email address").fill(email);
    await page.getByRole("button", { name: "Notify me" }).click();
    await expect(page.getByText("You're on the list")).toBeVisible();

    await page.goto("/coming-soon");
    await page.getByLabel("Email address").fill(email);
    await page.getByRole("button", { name: "Notify me" }).click();
    await expect(page.getByText("You're on the list")).toBeVisible();
  });

  test("rejects a malformed email client-side", async ({ page }) => {
    await page.goto("/coming-soon");
    const input = page.getByLabel("Email address");
    await input.fill("not-an-email");
    await page.getByRole("button", { name: "Notify me" }).click();
    // The browser's own type="email" validation blocks submission --
    // still on the page, no success message.
    await expect(page.getByText("You're on the list")).not.toBeVisible();
  });
});
