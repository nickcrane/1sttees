import { test, expect } from "@playwright/test";

// Proves the spec's isolation requirement in the one place it's actually
// enforced (middleware.ts), not just by code review: an unauthenticated
// visitor can reach neither the admin UI nor its API routes. Confirmed
// live during development that an earlier middleware matcher covering only
// /admin/:path* left /api/admin/** completely open -- this test exists
// specifically so that regression can't happen silently again.
test.describe("admin route isolation", () => {
  test("unauthenticated /admin redirects to the login page", async ({ page }) => {
    const response = await page.goto("/admin");
    expect(response?.ok()).toBe(true);
    await expect(page).toHaveURL(/\/admin\/login/);
  });

  test("unauthenticated /admin/orders redirects to the login page", async ({ page }) => {
    await page.goto("/admin/orders");
    await expect(page).toHaveURL(/\/admin\/login/);
  });

  test("unauthenticated API request to /api/admin/pricing/preview is rejected with 401, not a redirect", async ({
    request,
  }) => {
    const response = await request.post("/api/admin/pricing/preview", {
      data: { supplierPriceMinor: 699, supplierShippingMinor: 0 },
    });
    expect(response.status()).toBe(401);
  });

  test("the setup routes stay reachable without a session (the bootstrap flow needs this)", async ({ page }) => {
    const response = await page.goto("/admin/setup");
    expect(response?.ok()).toBe(true);
    await expect(page).toHaveURL(/\/admin\/setup/);
  });
});
