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
  const updated = await db.model.update({
    where: { id },
    data: {
      name: body.name,
      displayName: body.displayName,
      contextWindow: body.contextWindow,
      supportsTools: body.supportsTools,
      supportsVision: body.supportsVision,
      enabled: body.enabled,
    },
  });
  return NextResponse.json({ model: updated });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await db.model.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
