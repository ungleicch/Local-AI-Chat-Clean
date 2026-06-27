import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const conversations = await db.conversation.findMany({
    orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
    select: {
      id: true,
      title: true,
      providerId: true,
      modelId: true,
      systemPrompt: true,
      pinned: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return NextResponse.json({
    conversations: conversations.map((c) => ({
      ...c,
      updatedAt: c.updatedAt.toISOString(),
      createdAt: c.createdAt.toISOString(),
    })),
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const conv = await db.conversation.create({
    data: {
      title: body.title || "New chat",
      providerId: body.providerId || null,
      modelId: body.modelId || null,
      systemPrompt: body.systemPrompt || null,
    },
  });
  return NextResponse.json({
    conversation: {
      ...conv,
      updatedAt: conv.updatedAt.toISOString(),
      createdAt: conv.createdAt.toISOString(),
    },
  });
}
