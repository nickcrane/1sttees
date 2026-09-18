import { describe, expect, it } from "vitest";
import * as OTPAuth from "otpauth";
import { generateTotpSecret, totpEnrollmentUri, verifyTotpCode } from "@/lib/admin-auth/totp";

describe("generateTotpSecret", () => {
  it("generates a base32 secret of reasonable length, different each time", () => {
    const a = generateTotpSecret();
    const b = generateTotpSecret();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(16);
  });
});

describe("totpEnrollmentUri", () => {
  it("produces an otpauth:// URI carrying the issuer and email", () => {
    const secret = generateTotpSecret();
    const uri = totpEnrollmentUri("admin@example.com", secret);
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    expect(uri).toContain("admin%40example.com");
  });
});

describe("verifyTotpCode", () => {
  it("accepts the current valid code", () => {
    const secret = generateTotpSecret();
    const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret), digits: 6, period: 30 });
    const code = totp.generate();
    expect(verifyTotpCode("admin@example.com", secret, code)).toBe(true);
  });

  it("rejects an incorrect code", () => {
    const secret = generateTotpSecret();
    expect(verifyTotpCode("admin@example.com", secret, "000000")).toBe(false);
  });

  it("rejects a code generated from a different secret", () => {
    const secretA = generateTotpSecret();
    const secretB = generateTotpSecret();
    const totpB = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secretB), digits: 6, period: 30 });
    expect(verifyTotpCode("admin@example.com", secretA, totpB.generate())).toBe(false);
  });
});
