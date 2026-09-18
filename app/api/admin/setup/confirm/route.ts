import { NextResponse } from "next/server";
import { z } from "zod";
import { confirmAdminSetup, AdminSetupError } from "@/lib/admin-auth/setup";

const bodySchema = z.object({
  email: z.email(),
  code: z.string().length(6),
});

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  try {
    await confirmAdminSetup(parsed.data.email, parsed.data.code);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AdminSetupError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
