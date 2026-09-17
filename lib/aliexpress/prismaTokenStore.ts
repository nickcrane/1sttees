import { prisma } from "@/lib/prisma";
import { decryptSecret, encryptSecret } from "./crypto";
import type { TokenResponse } from "./schemas";
import { resolveTokenToPersist, type TokenSet, type TokenStore } from "./tokens";

const TOKEN_ROW_ID = "default";

export async function loadToken(): Promise<TokenSet | null> {
  const row = await prisma.aliExpressToken.findUnique({ where: { id: TOKEN_ROW_ID } });
  if (!row) return null;
  return {
    accessToken: decryptSecret(row.encryptedAccessToken),
    refreshToken: decryptSecret(row.encryptedRefreshToken),
    expiresAt: row.expiresAt,
    refreshExpiresAt: row.refreshExpiresAt,
  };
}

export async function saveToken(response: TokenResponse): Promise<TokenSet> {
  const existing = await loadToken();
  const resolved = resolveTokenToPersist(response, existing);

  const saved = await prisma.aliExpressToken.upsert({
    where: { id: TOKEN_ROW_ID },
    create: {
      id: TOKEN_ROW_ID,
      encryptedAccessToken: encryptSecret(resolved.accessToken),
      encryptedRefreshToken: encryptSecret(resolved.refreshToken),
      expiresAt: resolved.expiresAt,
      refreshExpiresAt: resolved.refreshExpiresAt,
    },
    update: {
      encryptedAccessToken: encryptSecret(resolved.accessToken),
      encryptedRefreshToken: encryptSecret(resolved.refreshToken),
      expiresAt: resolved.expiresAt,
      refreshExpiresAt: resolved.refreshExpiresAt,
    },
  });

  return {
    accessToken: resolved.accessToken,
    refreshToken: resolved.refreshToken,
    expiresAt: saved.expiresAt,
    refreshExpiresAt: saved.refreshExpiresAt,
  };
}

/** Real, Postgres-backed TokenStore -- AliExpressClient's default. See tokens.ts for the injectable interface and an in-memory double used in tests. */
export const prismaTokenStore: TokenStore = { load: loadToken, save: saveToken };
