// src/app/api/providers/[id]/route.ts

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PATCH /api/providers/[id]
// Update an existing provider. Only fields present in the body are updated
// (Prisma ignores `undefined` values, but we strip them explicitly to be
// safe). `apiKey` can be set to null explicitly to clear it.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();

  // Build the update payload — only include fields that are explicitly
  // present in the body. This prevents accidentally clearing fields that
  // the client didn't intend to change.
  const data: Record<string, unknown> = {};
  if (typeof body.name === "string") data.name = body.name;
  if (typeof body.type === "string") data.type = body.type;
  if (typeof body.baseUrl === "string") data.baseUrl = body.baseUrl;
  // apiKey can be: a string (new key), null (clear), or undefined (don't touch)
  if (body.apiKey !== undefined) data.apiKey = body.apiKey;
  if (typeof body.enabled === "boolean") data.enabled = body.enabled;
  if (typeof body.isLocal === "boolean") data.isLocal = body.isLocal;

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  try {
    const updated = await db.provider.update({
      where: { id },
      data,
      include: { models: true },
    });
    return NextResponse.json({ provider: updated });
  } catch (e) {
    return NextResponse.json(
      { error: `Failed to update provider: ${(e as Error).message}` },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await db.provider.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: `Failed to delete provider: ${(e as Error).message}` },
      { status: 500 }
    );
  }
}
