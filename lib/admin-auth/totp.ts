import * as OTPAuth from "otpauth";
import { env } from "@/lib/env";

export function generateTotpSecret(): string {
  return new OTPAuth.Secret({ size: 20 }).base32;
}

function totpFor(email: string, secretBase32: string): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    issuer: env.ADMIN_TOTP_ISSUER,
    label: email,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });
}

export function totpEnrollmentUri(email: string, secretBase32: string): string {
  return totpFor(email, secretBase32).toString();
}

/** Allows the previous/next 30s window too, to tolerate normal clock drift between server and authenticator app. */
export function verifyTotpCode(email: string, secretBase32: string, code: string): boolean {
  const delta = totpFor(email, secretBase32).validate({ token: code, window: 1 });
  return delta !== null;
}
