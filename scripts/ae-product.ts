#!/usr/bin/env tsx
/**
 * pnpm ae:product <id> -- look up a single AliExpress product by id, through
 * the same client/parsing path the sync pipeline will use. Fixture mode
 * (default) needs no credentials; live mode needs ALIEXPRESS_APP_KEY/SECRET
 * and a completed `pnpm ae:authorize` flow.
 */
import { AliExpressClient } from "../lib/aliexpress/client";
import { env } from "../lib/env";

async function main() {
  const productId = process.argv[2];
  if (!productId) {
    console.error("Usage: pnpm ae:product <product-id>");
    process.exit(1);
  }

  console.log(`Mode: ${env.ALIEXPRESS_MODE}`);
  const client = new AliExpressClient();
  const product = await client.getProductDetail(productId);
  console.log(JSON.stringify(product, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
