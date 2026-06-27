import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// List all favorites
export async function GET() {
  const favorites = await db.favoriteModel.findMany({
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ favorites });
}

// Add a favorite
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { providerId, modelName } = body;
  if (!providerId || !modelName) {
    return NextResponse.json({ error: "providerId and modelName required" }, { status: 400 });
  }
  const modelKey = `${providerId}:${modelName}`;
  const fav = await db.favoriteModel.upsert({
    where: { modelKey },
    create: { modelKey, providerId, modelName },
    update: { providerId, modelName },
  });
  return NextResponse.json({ favorite: fav });
}
