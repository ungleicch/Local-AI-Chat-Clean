import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// List models for a provider
export async function GET(req: NextRequest) {
  const providerId = req.nextUrl.searchParams.get("providerId");
  if (providerId) {
    const models = await db.model.findMany({
      where: { providerId },
      orderBy: { name: "asc" },
    });
    return NextResponse.json({ models });
  }
  const models = await db.model.findMany({
    include: { provider: true },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ models });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  if (!body.providerId || !body.name || !body.displayName) {
    return NextResponse.json(
      { error: "providerId, name, displayName required" },
      { status: 400 }
    );
  }
  const model = await db.model.create({
    data: {
      providerId: body.providerId,
      name: body.name,
      displayName: body.displayName,
      contextWindow: body.contextWindow ?? 8192,
      supportsTools: body.supportsTools ?? true,
      supportsVision: body.supportsVision ?? false,
    },
  });
  return NextResponse.json({ model });
}
