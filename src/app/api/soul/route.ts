import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET — return latest soul file
export async function GET() {
  const soul = await db.soulFile.findFirst({ orderBy: { version: "desc" } });
  return NextResponse.json({ soul });
}

// POST — create new version of soul file
export async function POST(req: NextRequest) {
  const body = await req.json();
  if (!body.content) {
    return NextResponse.json({ error: "content required" }, { status: 400 });
  }
  const latest = await db.soulFile.findFirst({ orderBy: { version: "desc" } });
  const version = (latest?.version || 0) + 1;
  const soul = await db.soulFile.create({
    data: { content: body.content, version },
  });
  return NextResponse.json({ soul });
}
