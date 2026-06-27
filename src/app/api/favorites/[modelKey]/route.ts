import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Delete a favorite by modelKey (URL-encoded)
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ modelKey: string }> }
) {
  const { modelKey } = await params;
  const decoded = decodeURIComponent(modelKey);
  try {
    await db.favoriteModel.delete({ where: { modelKey: decoded } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true }); // already deleted
  }
}
