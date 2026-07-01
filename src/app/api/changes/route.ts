// src/app/api/changes/route.ts

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import fs from "node:fs/promises";
import path from "node:path";

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

// POST /api/changes
//   body: {}                       → accept ALL pending changes (mark backups as accepted)
//   body: { id }                   → accept ONE change (mark backup as accepted, file stays as-is)
//   body: { id, restore: true }    → RESTORE one file from its backup (undo the change)
//   body: { restore: true }        → restore ALL pending files from their backups
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));

  // ----- Restore mode -----
  if (body.restore === true) {
    if (body.id) {
      const backup = await db.fileBackup.findUnique({ where: { id: body.id } });
      if (!backup) {
        return NextResponse.json({ error: "Backup not found" }, { status: 404 });
      }
      try {
        await fs.copyFile(backup.backupPath, backup.originalPath);
        await db.fileBackup.update({
          where: { id: body.id },
          data: { accepted: true },
        });
        return NextResponse.json({ ok: true, restored: 1 });
      } catch (e) {
        return NextResponse.json(
          { error: `Restore failed: ${(e as Error).message}` },
          { status: 500 }
        );
      }
    }
    // Restore ALL pending
    const pending = await db.fileBackup.findMany({ where: { accepted: false } });
    let restored = 0;
    for (const b of pending) {
      try {
        await fs.copyFile(b.backupPath, b.originalPath);
        await db.fileBackup.update({
          where: { id: b.id },
          data: { accepted: true },
        });
        restored++;
      } catch {
        // skip files that can't be restored
      }
    }
    return NextResponse.json({ ok: true, restored });
  }

  // ----- Accept mode (default) -----
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

// DELETE /api/changes?id=... — restore a single pending change from its backup
// (alternative entry point for "restore" action via DELETE)
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  const backup = await db.fileBackup.findUnique({ where: { id } });
  if (!backup) {
    return NextResponse.json({ error: "Backup not found" }, { status: 404 });
  }
  try {
    await fs.copyFile(backup.backupPath, backup.originalPath);
    await db.fileBackup.update({
      where: { id },
      data: { accepted: true },
    });
    return NextResponse.json({ ok: true, restored: 1 });
  } catch (e) {
    return NextResponse.json(
      { error: `Restore failed: ${(e as Error).message}` },
      { status: 500 }
    );
  }
}
