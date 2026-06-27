import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { runAgentLoop } from "@/lib/agent";
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
              }
              break;
            case "thinking":
              // Reasoning content — send as a separate SSE event type.
              // The client routes this to the thinking indicator, NOT the
              // response text. It never gets added to assistantText.
              if (chunk.content) {
                send("thinking", { content: chunk.content });
              }
              break;
            case "tool_call":
              if (chunk.toolCall) {
                toolCalls.push(chunk.toolCall);
                send("tool_call", { toolCall: chunk.toolCall });
              }
              break;
            case "tool_result":
              if (chunk.toolResult) {
                send("tool_result", { toolResult: chunk.toolResult });
                if (persist) {
                  // Persist tool result as a tool message
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
            case "error":
              send("error", { error: chunk.error });
              break;
            case "done":
              if (persist) {
                // Persist the assistant message
                await db.message.create({
                  data: {
                    conversationId,
                    role: "assistant",
                    content: assistantText,
                    toolCalls: toolCalls.length
                      ? JSON.stringify(toolCalls)
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
