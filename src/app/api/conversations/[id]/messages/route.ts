import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Add a user message to a conversation
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: conversationId } = await params;
  const body = await req.json();
  if (!body.content) {
    return NextResponse.json({ error: "content required" }, { status: 400 });
  }
  const msg = await db.message.create({
    data: {
      conversationId,
      role: body.role || "user",
      content: body.content,
      status: "complete",
    },
  });
  // Update conversation timestamp
  await db.conversation.update({
    where: { id: conversationId },
    data: { updatedAt: new Date() },
  });
  return NextResponse.json({
    message: {
      ...msg,
      createdAt: msg.createdAt.toISOString(),
    },
  });
}

// List messages
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const messages = await db.message.findMany({
    where: { conversationId: id },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({
    messages: messages.map((m) => ({
      ...m,
      toolCalls: m.toolCalls ? JSON.parse(m.toolCalls) : undefined,
      createdAt: m.createdAt.toISOString(),
    })),
  });
}
