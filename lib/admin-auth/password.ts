import * as argon2 from "argon2";

// argon2id specifically -- never bcrypt-with-defaults (project rule).
export async function hashPassword(plaintext: string): Promise<string> {
  return argon2.hash(plaintext, { type: argon2.argon2id });
}

/** Constant-time by construction (argon2.verify does the comparison internally); never short-circuit this with a manual string compare. */
export async function verifyPassword(hash: string, plaintext: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plaintext);
  } catch {
    // A malformed/foreign hash throws rather than returning false -- treat
    // it the same as "doesn't match" rather than letting it bubble up as
    // an unhandled error from a login attempt.
    return false;
  }
}
