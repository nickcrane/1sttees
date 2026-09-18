import { describe, expect, it } from "vitest";
import type { JWT } from "next-auth/jwt";
import type { Session } from "next-auth";
import { edgeAuthConfig } from "@/lib/admin-auth/edge-config";

describe("edgeAuthConfig callbacks", () => {
  it("jwt callback copies the authenticated user's id onto the token", async () => {
    const token = await edgeAuthConfig.callbacks!.jwt!({
      token: {} as JWT,
      user: { id: "admin-1" },
    } as Parameters<NonNullable<NonNullable<typeof edgeAuthConfig.callbacks>["jwt"]>>[0]);
    expect(token).toEqual({ adminUserId: "admin-1" });
  });

  it("jwt callback leaves the token alone when there's no user (a session refresh, not a sign-in)", async () => {
    const token = await edgeAuthConfig.callbacks!.jwt!({
      token: { adminUserId: "admin-1" } as JWT,
      user: undefined,
    } as unknown as Parameters<NonNullable<NonNullable<typeof edgeAuthConfig.callbacks>["jwt"]>>[0]);
    expect(token).toEqual({ adminUserId: "admin-1" });
  });

  it("session callback copies adminUserId from the token onto session.user.id", async () => {
    const session = (await edgeAuthConfig.callbacks!.session!({
      session: { user: {}, expires: "" } as Session,
      token: { adminUserId: "admin-1" } as JWT,
    } as Parameters<NonNullable<NonNullable<typeof edgeAuthConfig.callbacks>["session"]>>[0])) as Session;
    expect(session.user?.id).toBe("admin-1");
  });
});
