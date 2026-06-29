"use client";

import { Markdown } from "./markdown";
import { ThinkingIndicator } from "./thinking-indicator";
import { ToolCallRow, ToolResultRow, ThinkingRow } from "./block-rows";
import { cn } from "@/lib/utils";
import type { ChatMessage, ContentBlock } from "@/lib/types";
import { motion } from "framer-motion";
import { useChat } from "@/lib/stores/chat";
import { FileText } from "lucide-react";

interface MessageBubbleProps {
  message: ChatMessage;
  isStreaming?: boolean;
  isLast?: boolean;
}

export function MessageBubble({ message, isStreaming, isLast }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const isTool = message.role === "tool";

  const { expandedThinking, toggleThinking } = useChat();
  // Default to expanded for completed messages so thinking content is visible
  // after page reload (the store is in-memory only and cleared on refresh).
  // For streaming messages, start collapsed and auto-expand via ThinkingIndicator logic.
  const isExpanded = message.id in expandedThinking
    ? expandedThinking[message.id]
    : message.status !== "streaming";
  const hasThinking = (message.thinking?.length || 0) > 0;
  const isAssistantThinking = isStreaming && isLast && message.role === "assistant";
  const hasBlocks = (message.blocks?.length || 0) > 0;

  // Tool result messages are absorbed into the thinking indicator
  if (isTool) return null;

  if (isUser) {
    const hasAttachments = (message.attachments?.length || 0) > 0;
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
        className="w-full px-4 py-2"
      >
        <div className="mx-auto max-w-3xl">
          {/* File attachment previews above the message bubble */}
          {hasAttachments && (
            <div className="flex flex-wrap gap-1.5 mb-2 justify-end">
              {message.attachments!.map((fileId) => (
                <AttachmentChip key={fileId} fileId={fileId} />
              ))}
            </div>
          )}
          <div className="rounded-2xl bg-card border border-border px-4 py-2.5 text-sm whitespace-pre-wrap break-words text-foreground">
            {message.content}
          </div>
        </div>
      </motion.div>
    );
  }

  // Assistant message — if we have ordered content blocks, render them
  // interleaved (text + tool calls in the order they occurred).
  // Otherwise fall back to the old layout (thinking indicator + content).
  if (hasBlocks) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="w-full px-4 py-2"
      >
        <div className="mx-auto max-w-3xl">
          <div className="text-sm">
            <BlocksRenderer
              blocks={message.blocks!}
              isStreaming={isAssistantThinking || false}
            />
          </div>
        </div>
      </motion.div>
    );
  }

  // Fallback: old layout (thinking indicator above content)
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="w-full px-4 py-2"
    >
      <div className="mx-auto max-w-3xl">
        <div className="text-sm">
          {(hasThinking || isAssistantThinking) && (
            <ThinkingIndicator
              events={message.thinking || []}
              isStreaming={isAssistantThinking || false}
              expanded={isExpanded}
              onToggle={() => toggleThinking(message.id)}
            />
          )}

          {(message.content || isAssistantThinking) && (
            <div className="mt-1">
              <Markdown content={message.content || ""} />
              {isAssistantThinking && !message.content && (
                <span className="inline-block h-3 w-1.5 animate-pulse rounded-sm bg-foreground/40 align-middle ml-0.5" />
              )}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

/**
 * Renders ordered content blocks — text, tool calls, tool results, and
 * thinking — in the order they occurred. This makes tool calls appear
 * BETWEEN text statements instead of all grouped at the top.
 */
function BlocksRenderer({
  blocks,
  isStreaming,
}: {
  blocks: ContentBlock[];
  isStreaming: boolean;
}) {
  // Group consecutive thinking blocks into a collapsible section.
  // Text, tool_call, and tool_result blocks render inline in order.
  const renderBlock = (block: ContentBlock, idx: number) => {
    if (block.type === "text" && block.content) {
      return (
        <div key={idx} className="my-1">
          <Markdown content={block.content} />
        </div>
      );
    }
    if (block.type === "thinking" && block.content) {
      return <ThinkingRow key={idx} content={block.content} isStreaming={isStreaming} />;
    }
    if (block.type === "tool_call" && block.toolCall) {
      return <ToolCallRow key={idx} toolCall={block.toolCall} status={block.status} />;
    }
    if (block.type === "tool_result" && block.toolResult) {
      return <ToolResultRow key={idx} toolResult={block.toolResult} />;
    }
    return null;
  };

  return (
    <>
      {blocks.map((block, idx) => renderBlock(block, idx))}
      {isStreaming && (
        <span className="inline-block h-3 w-1.5 animate-pulse rounded-sm bg-foreground/40 align-middle ml-0.5" />
      )}
    </>
  );
}

/**
 * A small thumbnail chip for a file attached to a user message.
 * Images render as a preview; other files show a document icon.
 * The component fetches file metadata on mount to determine the mime type.
 */
function AttachmentChip({ fileId }: { fileId: string }) {
  return (
    <div className="h-14 w-14 overflow-hidden rounded-lg bg-foreground/[0.06] border border-border/40 flex-shrink-0">
      {/* Try to render as an image — falls back to icon if not an image */}
      <img
        src={`/api/files/${fileId}`}
        alt="attachment"
        className="h-full w-full object-cover"
        onError={(e) => {
          // Not an image — replace with a file icon placeholder
          const target = e.currentTarget;
          target.style.display = "none";
          const parent = target.parentElement;
          if (parent && !parent.querySelector("svg")) {
            const div = document.createElement("div");
            div.className = "flex h-full w-full items-center justify-center";
            div.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>`;
            parent.appendChild(div);
          }
        }}
      />
    </div>
  );
}
