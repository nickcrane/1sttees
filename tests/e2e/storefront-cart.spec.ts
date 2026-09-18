import { test, expect } from "@playwright/test";
import { prisma } from "@/lib/prisma";

// Self-seeding: CI's Postgres starts empty (migrate deploy runs no seed
// data), and this suite shouldn't depend on whatever's in a developer's
// local DB either. Creates its own product/variant chain and tears it back
// down, rather than asserting against the admin-import fixture data.
const SLUG = "e2e-test-bamboo-tee";

/**
 * Removes any product from a previous run of this suite -- a crashed run
 * (or one whose teardown itself failed) can leave the fixed-slug row
 * behind, which then breaks the next run's `create` on a unique constraint.
 * Deletes any CartItems referencing the product's variants first: they're
 * not cascaded from Product (CartItem -> ProductVariant has no onDelete),
 * so a cart left over from the "add to cart" test blocks the Product
 * delete otherwise -- confirmed live as a real FK-violation failure.
 */
async function cleanupLeftovers() {
  const product = await prisma.product.findUnique({ where: { slug: SLUG }, include: { variants: true } });
  if (product) {
    await prisma.cartItem.deleteMany({ where: { productVariantId: { in: product.variants.map((v) => v.id) } } });
    await prisma.product.delete({ where: { id: product.id } });
  }
  await prisma.supplierProduct.deleteMany({ where: { aeProductId: { startsWith: "e2e-" } } });
}

async function seedProduct() {
  await cleanupLeftovers();

  const supplierProduct = await prisma.supplierProduct.create({
    data: {
      aeProductId: `e2e-${Date.now()}`,
      title: "E2E Test Bamboo Tee",
      raw: {},
      imageUrls: [],
      variants: {
        create: [
          { aeSkuId: "sku-a", skuAttrs: "size:70mm", supplierPriceMinor: 300, currency: "GBP" },
          { aeSkuId: "sku-b", skuAttrs: "size:83mm", supplierPriceMinor: 350, currency: "GBP" },
        ],
      },
    },
    include: { variants: true },
  });

  await prisma.product.create({
    data: {
      slug: SLUG,
      title: "E2E Test Bamboo Tee",
      description: "A bamboo tee used only by the storefront e2e suite.",
      images: [],
      status: "PUBLISHED",
      variants: {
        create: [
          { title: "70mm", priceMinor: 999, currency: "GBP", position: 0, supplierVariantId: supplierProduct.variants[0].id },
          { title: "83mm", priceMinor: 1099, currency: "GBP", position: 1, supplierVariantId: supplierProduct.variants[1].id },
        ],
      },
    },
  });
}

// `fullyParallel: true` (playwright.config.ts) otherwise runs each test in
// this file on a different worker -- since beforeAll/afterAll are scoped
// per worker, that raced multiple workers seeding/tearing down the same
// SLUG concurrently (confirmed live: FK violations and flaky "not found"
// failures). Serial mode keeps one worker owning the whole describe block.
test.describe.configure({ mode: "serial" });

test.describe("storefront browsing and cart", () => {
  test.beforeAll(async () => {
    await seedProduct();
  });

  test.afterAll(async () => {
    await cleanupLeftovers();
    await prisma.$disconnect();
  });

  test("product is listed on /products and links to its detail page", async ({ page }) => {
    await page.goto("/products");
    await expect(page.getByRole("link", { name: /E2E Test Bamboo Tee/ })).toBeVisible();

    await page.getByRole("link", { name: /E2E Test Bamboo Tee/ }).click();
    await expect(page).toHaveURL(`/products/${SLUG}`);
    await expect(page.getByRole("heading", { name: "E2E Test Bamboo Tee" })).toBeVisible();
  });

  test("selecting a variant updates the displayed price", async ({ page }) => {
    await page.goto(`/products/${SLUG}`);
    await expect(page.getByText("£9.99")).toBeVisible();

    await page.getByText("83mm", { exact: true }).click();
    await expect(page.getByText("£10.99")).toBeVisible();
  });

  test("adding to cart updates the header count and the drawer contents", async ({ page }) => {
    await page.goto(`/products/${SLUG}`);
    await expect(page.getByRole("button", { name: /Cart, 0 items/ })).toBeVisible();

    await page.getByRole("button", { name: "Add to cart" }).click();
    await expect(page.getByRole("button", { name: /Cart, 1 item/ })).toBeVisible();

    await page.getByRole("button", { name: /Cart,/ }).click();
    // Scoped to the drawer -- the product title/price are also on the page
    // behind it (the Sheet overlays rather than replacing the page).
    const drawer = page.getByRole("dialog");
    await expect(drawer.getByText("E2E Test Bamboo Tee")).toBeVisible();
    await expect(drawer.getByText("Subtotal")).toBeVisible();

    await drawer.getByRole("button", { name: "Remove" }).click();
    await expect(drawer.getByText("Your cart is empty.")).toBeVisible();
  });
});
