"use client";

import { Markdown } from "./markdown";
import { ThinkingIndicator } from "./thinking-indicator";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/lib/types";
import { motion } from "framer-motion";
import { useChat } from "@/lib/stores/chat";

interface MessageBubbleProps {
  message: ChatMessage;
  isStreaming?: boolean;
  isLast?: boolean;
}

export function MessageBubble({ message, isStreaming, isLast }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const isTool = message.role === "tool";

  const { expandedThinking, toggleThinking } = useChat();
  const isExpanded = expandedThinking[message.id] || false;
  const hasThinking = (message.thinking?.length || 0) > 0;
  const isAssistantThinking = isStreaming && isLast && message.role === "assistant";

  // Tool result messages are absorbed into the thinking indicator
  if (isTool) return null;

  if (isUser) {
    // User message — same grey background as input bar, positioned where input bar was
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
        className="w-full px-4 py-2"
      >
        <div className="mx-auto max-w-3xl">
          <div className="rounded-2xl bg-card border border-border px-4 py-2.5 text-sm whitespace-pre-wrap break-words text-foreground">
            {message.content}
          </div>
        </div>
      </motion.div>
    );
  }

  // Assistant message
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="w-full px-4 py-2"
    >
      <div className="mx-auto max-w-3xl">
        <div className="text-sm">
          {/* Thinking indicator (if there are thinking events or currently thinking) */}
          {(hasThinking || isAssistantThinking) && (
            <ThinkingIndicator
              events={message.thinking || []}
              isStreaming={isAssistantThinking || false}
              expanded={isExpanded}
              onToggle={() => toggleThinking(message.id)}
            />
          )}

          {/* Response streams in below the thinking section */}
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
