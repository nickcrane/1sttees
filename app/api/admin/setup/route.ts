import { NextResponse } from "next/server";
import { toDataURL } from "qrcode";
import { z } from "zod";
import { startAdminSetup, AdminSetupError } from "@/lib/admin-auth/setup";

const bodySchema = z.object({
  email: z.email(),
  password: z.string().min(12, "Password must be at least 12 characters"),
});

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  try {
    const { totpUri, secretBase32 } = await startAdminSetup(parsed.data.email, parsed.data.password);
    const qrCodeDataUrl = await toDataURL(totpUri);
    return NextResponse.json({ qrCodeDataUrl, secretBase32 });
  } catch (error) {
    if (error instanceof AdminSetupError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
