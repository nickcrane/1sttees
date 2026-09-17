#!/usr/bin/env tsx
/**
 * One-time OAuth setup for live mode:
 *   pnpm ae:authorize                -- prints the URL to open and approve in a browser
 *   pnpm ae:authorize --code <code>  -- exchanges the code AliExpress redirected back with
 *
 * Not part of the mission brief's explicit Phase 1 deliverable (only
 * `pnpm ae:product` is named there), but there's no way to obtain a real
 * token for live mode without it, and the admin "re-authorise" button this
 * duplicates in spirit isn't built until Phase 2's admin UI.
 */
import { AliExpressClient } from "../lib/aliexpress/client";

async function main() {
  const codeFlagIndex = process.argv.indexOf("--code");

  if (codeFlagIndex === -1) {
    const client = new AliExpressClient();
    console.log("Open this URL, log in, and approve access:\n");
    console.log(client.getAuthorizeUrl());
    console.log("\nThen copy the `code` query param from the redirect URL and run:");
    console.log("  pnpm ae:authorize --code <code>");
    return;
  }

  const code = process.argv[codeFlagIndex + 1];
  if (!code) {
    console.error("Usage: pnpm ae:authorize --code <code>");
    process.exit(1);
  }

  const client = new AliExpressClient();
  const token = await client.exchangeCodeForToken(code);
  console.log("Authorized. Token saved (encrypted) to the database.");
  console.log(`Access token expires at: ${token.expiresAt.toISOString()}`);
  console.log(`Refresh token expires at: ${token.refreshExpiresAt.toISOString()}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
