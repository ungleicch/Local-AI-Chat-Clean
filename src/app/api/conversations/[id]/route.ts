import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const conv = await db.conversation.findUnique({
    where: { id },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!conv) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({
    conversation: {
      ...conv,
      messages: conv.messages.map((m) => ({
        ...m,
        toolCalls: m.toolCalls ? JSON.parse(m.toolCalls) : undefined,
        // Restore thinking events (reasoning trace + tool calls) so they
        // survive page reload and chat switching.
        thinking: m.thinking ? JSON.parse(m.thinking) : undefined,
        createdAt: m.createdAt.toISOString(),
      })),
      updatedAt: conv.updatedAt.toISOString(),
      createdAt: conv.createdAt.toISOString(),
    },
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const updated = await db.conversation.update({
    where: { id },
    data: {
      title: body.title,
      providerId: body.providerId,
      modelId: body.modelId,
      systemPrompt: body.systemPrompt,
      pinned: body.pinned,
    },
  });
  return NextResponse.json({
    conversation: {
      ...updated,
      updatedAt: updated.updatedAt.toISOString(),
      createdAt: updated.createdAt.toISOString(),
    },
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await db.conversation.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
