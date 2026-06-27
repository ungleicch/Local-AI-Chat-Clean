import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET — list user profile or knowledge entries
export async function GET(req: NextRequest) {
  const kind = req.nextUrl.searchParams.get("kind") || "profile";
  if (kind === "knowledge") {
    const entries = await db.knowledgeEntry.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return NextResponse.json({ entries });
  }
  const entries = await db.userProfile.findMany({
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
  return NextResponse.json({ entries });
}

// DELETE — delete a memory entry by ID
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  // Try both tables
  try {
    await db.userProfile.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    try {
      await db.knowledgeEntry.delete({ where: { id } });
      return NextResponse.json({ ok: true });
    } catch {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
  }
}
