// src/app/api/upload/route.ts

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/upload — multipart file upload
export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const files = formData.getAll("files");
  const conversationId = formData.get("conversationId") as string | null;

  if (!files || files.length === 0) {
    return NextResponse.json({ error: "No files provided" }, { status: 400 });
  }

  const uploaded: Array<{
    id: string;
    filename: string;
    mimeType: string;
    size: number;
  }> = [];
  for (const file of files) {
    if (!(file instanceof File)) continue;
    const id = crypto.randomUUID();
    const ext = path.extname(file.name);
    const storagePath = path.resolve(process.cwd(), "uploads", `${id}${ext}`);
    await fs.mkdir(path.dirname(storagePath), { recursive: true });
    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(storagePath, buffer);

    const record = await db.uploadedFile.create({
      data: {
        id,
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        size: buffer.length,
        storagePath,
        extracted: false,
      },
    });
    uploaded.push({
      id: record.id,
      filename: record.filename,
      mimeType: record.mimeType,
      size: record.size,
    });
  }

  // If conversationId provided, we don't auto-link — the client sends the file IDs with the message
  return NextResponse.json({ files: uploaded });
}
