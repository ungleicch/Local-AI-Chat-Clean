import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const updated = await db.provider.update({
    where: { id },
    data: {
      name: body.name,
      type: body.type,
      baseUrl: body.baseUrl,
      apiKey: body.apiKey,
      enabled: body.enabled,
      isLocal: body.isLocal,
    },
    include: { models: true },
  });
  return NextResponse.json({ provider: updated });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await db.provider.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
