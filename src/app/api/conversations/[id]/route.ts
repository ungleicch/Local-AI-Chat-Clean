// src/app/api/conversations/[id]/route.ts

// src/app/api/conversations/[id]/route.ts

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import path from "node:path";
import fs from "node:fs/promises";

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
        // Restore ordered content blocks for interleaved rendering.
        blocks: m.blocks ? JSON.parse(m.blocks) : undefined,
        // Restore attachment IDs so file previews survive reload.
        attachments: m.attachments ? JSON.parse(m.attachments) : undefined,
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
  // Only update fields that are explicitly provided in the body. This
  // prevents accidentally clearing out fields like `title` when the client
  // only wants to update `pinned`, or vice versa.
  const data: Record<string, unknown> = {};
  if (typeof body.title === "string") data.title = body.title || "Untitled";
  if (typeof body.providerId === "string") data.providerId = body.providerId;
  if (typeof body.modelId === "string") data.modelId = body.modelId;
  if (typeof body.systemPrompt === "string") data.systemPrompt = body.systemPrompt;
  if (typeof body.pinned === "boolean") data.pinned = body.pinned;

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const updated = await db.conversation.update({
    where: { id },
    data,
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

  // Clean up the conversation's workspace directory on disk.
  // We do this BEFORE deleting the DB record so that even if the DB delete
  // fails, we don't leave orphaned files. If the DB delete fails, the user
  // can retry — the workspace is already gone but that's fine because
  // the conversation's messages (which reference the files) will be gone
  // once the DB delete succeeds.
  try {
    const workDir = path.resolve(process.cwd(), "workspace", id);
    // Defensive: verify the resolved path is inside the workspace root
    // to prevent accidental deletion of unrelated directories.
    const workspaceRoot = path.resolve(process.cwd(), "workspace");
    if (workDir.startsWith(workspaceRoot + path.sep) || workDir === workspaceRoot) {
      await fs.rm(workDir, { recursive: true, force: true });
    }
  } catch {
    // Best-effort cleanup — don't fail the delete if cleanup fails.
  }

  try {
    await db.conversation.delete({ where: { id } });
  } catch (e) {
    // If conversation doesn't exist, still return ok (idempotent delete)
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ ok: true });
}