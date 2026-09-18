import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/admin-auth/password";

describe("hashPassword / verifyPassword", () => {
  it("round-trips a correct password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword(hash, "correct horse battery staple")).toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword(hash, "wrong password")).toBe(false);
  });

  it("produces an argon2id hash, not bcrypt or plaintext", async () => {
    const hash = await hashPassword("some password");
    expect(hash.startsWith("$argon2id$")).toBe(true);
  });

  it("does not throw on a malformed hash -- returns false instead", async () => {
    await expect(verifyPassword("not-a-real-hash", "anything")).resolves.toBe(false);
  });

  it("produces a different hash each time (random salt)", async () => {
    const a = await hashPassword("same password");
    const b = await hashPassword("same password");
    expect(a).not.toBe(b);
  });
});
