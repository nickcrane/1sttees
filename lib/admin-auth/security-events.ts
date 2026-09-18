import { prisma } from "@/lib/prisma";

export type AdminSecurityEventType = "SIGN_IN_SUCCESS" | "SIGN_IN_FAILURE" | "TOTP_ENROLLED" | "TOTP_FAILURE" | "SIGN_OUT";

export async function logAdminSecurityEvent(params: {
  email: string;
  type: AdminSecurityEventType;
  adminUserId?: string;
  ip?: string | null;
}): Promise<void> {
  await prisma.adminSecurityEvent.create({
    data: {
      email: params.email,
      type: params.type,
      adminUserId: params.adminUserId,
      ip: params.ip ?? undefined,
    },
  });
}
