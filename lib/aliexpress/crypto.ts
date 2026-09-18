// Re-exported from the shared implementation (lib/crypto.ts) now that
// AES-256-GCM at-rest encryption is used for more than just the AliExpress
// token (admin TOTP secrets too, as of Phase 2). Kept as a re-export
// rather than updating every existing import site.
export { encryptSecret, decryptSecret } from "@/lib/crypto";
