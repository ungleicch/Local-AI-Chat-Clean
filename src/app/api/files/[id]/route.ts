import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import fs from "node:fs/promises";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/files/[id] — serve an uploaded/generated file
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const file = await db.uploadedFile.findUnique({ where: { id } });
  if (!file) {
    return new NextResponse("File not found", { status: 404 });
  }
  try {
    const buffer = await fs.readFile(file.storagePath);
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": file.mimeType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new NextResponse("File not found on disk", { status: 404 });
  }
}
