import { prisma } from "@/lib/prisma";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import { isAllowlistedAdminEmail } from "./allowlist";
import { hashPassword } from "./password";
import { generateTotpSecret, totpEnrollmentUri, verifyTotpCode } from "./totp";
import { logAdminSecurityEvent } from "./security-events";

export class AdminSetupError extends Error {}

/**
 * Step 1 of admin signup: allowlisted email + a chosen password. Generates
 * a fresh TOTP secret and stores it (encrypted) alongside the password
 * hash, but leaves `totpEnabledAt` unset -- sign-in stays impossible until
 * `confirmAdminSetup` verifies a real code from the authenticator app, so a
 * half-finished setup can never be used to sign in with password alone.
 */
export async function startAdminSetup(email: string, password: string): Promise<{ totpUri: string; secretBase32: string }> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!isAllowlistedAdminEmail(normalizedEmail)) {
    throw new AdminSetupError("This email is not on the admin allowlist.");
  }

  const existing = await prisma.adminUser.findUnique({ where: { email: normalizedEmail } });
  if (existing?.totpEnabledAt) {
    throw new AdminSetupError("This admin account is already fully set up -- sign in instead.");
  }

  const passwordHash = await hashPassword(password);
  const secretBase32 = generateTotpSecret();

  await prisma.adminUser.upsert({
    where: { email: normalizedEmail },
    create: { email: normalizedEmail, passwordHash, encryptedTotpSecret: encryptSecret(secretBase32) },
    update: { passwordHash, encryptedTotpSecret: encryptSecret(secretBase32), totpEnabledAt: null },
  });

  return { totpUri: totpEnrollmentUri(normalizedEmail, secretBase32), secretBase32 };
}

/** Step 2: confirms the admin actually has the secret in their authenticator app before allowing sign-in. */
export async function confirmAdminSetup(email: string, code: string): Promise<void> {
  const normalizedEmail = email.trim().toLowerCase();
  const adminUser = await prisma.adminUser.findUnique({ where: { email: normalizedEmail } });
  if (!adminUser?.encryptedTotpSecret) {
    throw new AdminSetupError("No pending setup found for this email -- start setup again.");
  }
  if (adminUser.totpEnabledAt) {
    throw new AdminSetupError("This admin account is already fully set up -- sign in instead.");
  }

  const secret = decryptSecret(adminUser.encryptedTotpSecret);
  if (!verifyTotpCode(normalizedEmail, secret, code)) {
    await logAdminSecurityEvent({ email: normalizedEmail, type: "TOTP_FAILURE", adminUserId: adminUser.id });
    throw new AdminSetupError("That code didn't match. Check your authenticator app and try again.");
  }

  await prisma.adminUser.update({ where: { id: adminUser.id }, data: { totpEnabledAt: new Date() } });
  await logAdminSecurityEvent({ email: normalizedEmail, type: "TOTP_ENROLLED", adminUserId: adminUser.id });
}
