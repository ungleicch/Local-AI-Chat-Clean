// src/app/api/chat/route.ts
// src/app/api/chat/route.ts

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { runAgentLoop } from "@/lib/agent";
import type { ContentBlock } from "@/lib/types";
import path from "node:path";
import fs from "node:fs/promises";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ChatRequestBody {
  conversationId: string;
  providerId: string;
  modelId: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  maxSteps?: number;
  enabledTools?: string[];
  // If true, persist messages to DB on the server side
  persist?: boolean;
  // File IDs attached to the latest user message (so agent can find them)
  attachments?: string[];
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as ChatRequestBody;
  const {
    conversationId,
    providerId,
    modelId,
    systemPrompt,
    temperature,
    maxTokens,
    maxSteps,
    enabledTools,
    persist = true,
    attachments = [],
  } = body;

  if (!providerId || !modelId || !conversationId) {
    return new Response(
      JSON.stringify({ error: "providerId, modelId, conversationId are required" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Load provider from DB
  const provider = await db.provider.findUnique({ where: { id: providerId } });
  if (!provider || !provider.enabled) {
    return new Response(
      JSON.stringify({ error: "Provider not found or disabled" }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    );
  }
  const model = await db.model.findFirst({
    where: { id: modelId, providerId },
  });
  if (!model) {
    return new Response(
      JSON.stringify({ error: "Model not found" }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    );
  }

  // Load conversation history from DB
  const dbMessages = await db.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
  });

  const history = dbMessages.map((m) => ({
    id: m.id,
    role: m.role as "user" | "assistant" | "system" | "tool",
    content: m.content,
    toolCalls: m.toolCalls ? JSON.parse(m.toolCalls) : undefined,
    toolCallId: m.toolCallId || undefined,
    toolName: m.toolName || undefined,
    status: m.status as "streaming" | "complete" | "error",
    createdAt: m.createdAt.toISOString(),
  }));

  // If there are attachments, augment the last user message with file context
  if (attachments.length > 0) {
    const files = await db.uploadedFile.findMany({
      where: { id: { in: attachments } },
    });
    if (files.length > 0) {
      const fileList = files
        .map((f) => `• ${f.filename} (ID: ${f.id}, type: ${f.mimeType}, size: ${f.size} bytes)`)
        .join("\n");
      const lastUser = [...history].reverse().find((m) => m.role === "user");
      if (lastUser) {
        lastUser.content =
          lastUser.content +
          `\n\n[Attached files:]\n${fileList}\n\nUse the extract_file tool with the file IDs to read their contents if needed.`;
      }
    }
  }

  // Set up workspace directory for file tools
  const workDir = path.resolve(process.cwd(), "workspace", conversationId);
  await fs.mkdir(workDir, { recursive: true });

  // Set up SSE
  const encoder = new TextEncoder();
  const abortController = new AbortController();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      };

      try {
        let assistantText = "";
        const toolCalls: Array<{
          id: string;
          name: string;
          arguments: Record<string, unknown>;
        }> = [];
        // Collect thinking events (reasoning trace + tool calls + tool results)
        // so they can be persisted to the DB and restored on page reload.
        const thinkingEvents: Array<{
          id: string;
          type: "thinking" | "tool_call" | "tool_result";
          content?: string;
          toolName?: string;
          toolArgs?: Record<string, unknown>;
          toolResult?: string;
          timestamp: string;
          status?: string;
        }> = [];
        // Stable ID for the streaming thinking event
        let thinkingEventId: string | null = null;
        // Ordered content blocks for interleaved rendering — text and tool
        // calls appear in the order they occurred, not all grouped at top.
        const contentBlocks: ContentBlock[] = [];
        // Track the current text block (so consecutive text chunks merge
        // into one block rather than creating many tiny blocks)
        let currentTextBlockIdx = -1;
        // Track the current thinking block index (so consecutive thinking
        // chunks merge into one block rather than creating many tiny blocks)
        let currentThinkingBlockIdx = -1;

        for await (const chunk of runAgentLoop({
          providerId,
          providerType: provider.type,
          providerBaseUrl: provider.baseUrl,
          providerApiKey: provider.apiKey || undefined,
          providerIsLocal: provider.isLocal,
          modelId: model.name,
          modelSupportsTools: model.supportsTools,
          systemPrompt,
          temperature,
          maxTokens: Math.min(maxTokens || 4096, model.contextWindow),
          maxSteps,
          enabledTools,
          workDir,
          conversationId,
          signal: abortController.signal,
          history,
        })) {
          switch (chunk.type) {
            case "text":
              if (chunk.content) {
                assistantText += chunk.content;
                send("text", { content: chunk.content });
                // Add to content blocks — merge with previous text block
                // if consecutive (avoids many tiny text blocks)
                if (currentTextBlockIdx >= 0 && contentBlocks[currentTextBlockIdx].type === "text") {
                  contentBlocks[currentTextBlockIdx].content =
                    (contentBlocks[currentTextBlockIdx].content || "") + chunk.content;
                } else {
                  contentBlocks.push({
                    type: "text",
                    content: chunk.content,
                    timestamp: new Date().toISOString(),
                  });
                  currentTextBlockIdx = contentBlocks.length - 1;
                }
                currentThinkingBlockIdx = -1; // text resets the current thinking block
              }
              break;
            case "thinking":
              // Reasoning content — send as a separate SSE event type.
              if (chunk.content) {
                send("thinking", { content: chunk.content });
                // Merge consecutive thinking chunks into one block (just like
                // text chunks) so we don't create hundreds of tiny blocks.
                if (currentThinkingBlockIdx >= 0 && contentBlocks[currentThinkingBlockIdx].type === "thinking") {
                  contentBlocks[currentThinkingBlockIdx].content =
                    (contentBlocks[currentThinkingBlockIdx].content || "") + chunk.content;
                } else {
                  contentBlocks.push({
                    type: "thinking",
                    content: chunk.content,
                    timestamp: new Date().toISOString(),
                    status: "active",
                  });
                  currentThinkingBlockIdx = contentBlocks.length - 1;
                }
                currentTextBlockIdx = -1; // next text starts a new block
                // Collect for persistence (thinking events array)
                if (!thinkingEventId) {
                  thinkingEventId = `thinking-${Date.now()}`;
                  thinkingEvents.push({
                    id: thinkingEventId,
                    type: "thinking",
                    content: chunk.content,
                    timestamp: new Date().toISOString(),
                    status: "active",
                  });
                } else {
                  const evt = thinkingEvents.find((e) => e.id === thinkingEventId);
                  if (evt) evt.content = (evt.content || "") + chunk.content;
                }
              }
              break;
            case "tool_call":
              if (chunk.toolCall) {
                toolCalls.push(chunk.toolCall);
                send("tool_call", { toolCall: chunk.toolCall });
                // Add as a tool_call block (interleaved with text)
                contentBlocks.push({
                  type: "tool_call",
                  toolCall: chunk.toolCall,
                  timestamp: new Date().toISOString(),
                  status: "active",
                });
                currentTextBlockIdx = -1; // next text starts a new block
                currentThinkingBlockIdx = -1; // next thinking starts a new block
                // Collect for persistence (thinking events array)
                thinkingEvents.push({
                  id: chunk.toolCall.id,
                  type: "tool_call",
                  toolName: chunk.toolCall.name,
                  toolArgs: chunk.toolCall.arguments,
                  timestamp: new Date().toISOString(),
                  status: "active",
                });
              }
              break;
            case "tool_result":
              if (chunk.toolResult) {
                send("tool_result", { toolResult: chunk.toolResult });
                // Add as a tool_result block
                contentBlocks.push({
                  type: "tool_result",
                  toolResult: chunk.toolResult,
                  timestamp: new Date().toISOString(),
                  status: "complete",
                });
                currentTextBlockIdx = -1; // next text starts a new block
                currentThinkingBlockIdx = -1; // next thinking starts a new block
                // Mark the corresponding tool_call event as complete
                const callEvt = thinkingEvents.find(
                  (e) => e.id === chunk.toolResult!.toolCallId && e.type === "tool_call"
                );
                if (callEvt) callEvt.status = "complete";
                // Collect result event for persistence
                thinkingEvents.push({
                  id: `${chunk.toolResult.toolCallId}-result`,
                  type: "tool_result",
                  toolName: chunk.toolResult.name,
                  toolResult: chunk.toolResult.content,
                  timestamp: new Date().toISOString(),
                  status: "complete",
                });
                if (persist) {
                  await db.message.create({
                    data: {
                      conversationId,
                      role: "tool",
                      content: chunk.toolResult.content,
                      toolCallId: chunk.toolResult.toolCallId,
                      toolName: chunk.toolResult.name,
                      status: "complete",
                    },
                  });
                }
              }
              break;
            case "step":
              send("step", { step: chunk.step });
              break;
            case "file_write":
              // Forward file-write events to the client. The frontend file
              // panel listens for these to update its tree and show live
              // content of the file being written.
              if (chunk.fileWrite) {
                send("file_write", { fileWrite: chunk.fileWrite });
              }
              break;
            case "error":
              send("error", { error: chunk.error });
              break;
            case "done":
              if (persist) {
                // Persist the assistant message with thinking events + blocks
                await db.message.create({
                  data: {
                    conversationId,
                    role: "assistant",
                    content: assistantText,
                    toolCalls: toolCalls.length
                      ? JSON.stringify(toolCalls)
                      : null,
                    // Persist thinking events (reasoning trace + tool calls)
                    thinking: thinkingEvents.length > 0
                      ? JSON.stringify(thinkingEvents)
                      : null,
                    // Persist ordered content blocks for interleaved rendering
                    blocks: contentBlocks.length > 0
                      ? JSON.stringify(contentBlocks)
                      : null,
                    status: "complete",
                  },
                });
                // Update conversation updatedAt
                await db.conversation.update({
                  where: { id: conversationId },
                  data: { updatedAt: new Date() },
                });
                // Auto-title: if this is the first exchange, set title
                const conv = await db.conversation.findUnique({
                  where: { id: conversationId },
                });
                if (conv && (conv.title === "New chat" || !conv.title)) {
                  const lastUser = history
                    .filter((h) => h.role === "user")
                    .slice(-1)[0];
                  if (lastUser) {
                    const title =
                      lastUser.content.slice(0, 60).trim() +
                      (lastUser.content.length > 60 ? "…" : "");
                    await db.conversation.update({
                      where: { id: conversationId },
                      data: { title },
                    });
                  }
                }
              }
              send("done", {});
              controller.close();
              return;
          }
        }
        // Safety close
        controller.close();
      } catch (e) {
        send("error", { error: (e as Error).message });
        controller.close();
      }
    },
    cancel() {
      abortController.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}