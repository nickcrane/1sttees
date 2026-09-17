import type { TokenResponse } from "./schemas";

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  refreshExpiresAt: Date;
}

/**
 * Token persistence, behind an interface -- so unit tests can inject an
 * in-memory double instead of needing a real Postgres connection just to
 * exercise OAuth response parsing. See prismaTokenStore.ts for the real,
 * Postgres-backed implementation `AliExpressClient` defaults to.
 */
export interface TokenStore {
  load(): Promise<TokenSet | null>;
  save(response: TokenResponse): Promise<TokenSet>;
}

/**
 * Resolves what to persist from a token response, refusing to null out a
 * still-good refresh_token just because a refresh response happened not to
 * repeat it. Matches a real incident the sibling aliexpress-dashboard
 * project hit: a refresh response that omits refresh_token doesn't mean
 * it's gone -- overwriting the stored value with null there permanently
 * breaks every refresh after the first one, until a full re-authorization.
 * The token that just successfully authenticated this request is still
 * good regardless of whether the response happened to repeat it.
 */
export function resolveTokenToPersist(
  response: TokenResponse,
  existing: TokenSet | null,
  now: number = Date.now()
): { accessToken: string; refreshToken: string; expiresAt: Date; refreshExpiresAt: Date } {
  const refreshToken = response.refresh_token ?? existing?.refreshToken;
  if (!refreshToken) {
    throw new Error(
      "Token response has no refresh_token and none is on file -- cannot save a token set without one."
    );
  }
  const expiresAt = new Date(now + (response.expires_in ?? 0) * 1000);
  const refreshExpiresAt =
    response.refresh_expires_in !== undefined
      ? new Date(now + response.refresh_expires_in * 1000)
      : existing?.refreshExpiresAt ?? new Date(now);

  return { accessToken: response.access_token, refreshToken, expiresAt, refreshExpiresAt };
}
