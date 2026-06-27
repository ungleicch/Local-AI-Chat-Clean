import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// List all pending file changes (backups not yet accepted)
export async function GET() {
  const pending = await db.fileBackup.findMany({
    where: { accepted: false },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({
    changes: pending.map((b) => ({
      id: b.id,
      originalPath: b.originalPath,
      backupPath: b.backupPath,
      createdAt: b.createdAt.toISOString(),
    })),
  });
}

// Accept all pending changes (mark backups as accepted)
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (body.id) {
    await db.fileBackup.update({
      where: { id: body.id },
      data: { accepted: true },
    });
    return NextResponse.json({ ok: true, accepted: 1 });
  }
  const result = await db.fileBackup.updateMany({
    where: { accepted: false },
    data: { accepted: true },
  });
  return NextResponse.json({ ok: true, accepted: result.count });
}
