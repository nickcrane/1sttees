import { env } from "@/lib/env";

export function isAllowlistedAdminEmail(email: string): boolean {
  const allowlist = (env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return allowlist.includes(email.trim().toLowerCase());
}
