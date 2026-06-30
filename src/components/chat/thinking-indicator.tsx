// src/components/chat/thinking-indicator.tsx
"use client";

import { Loader2, Brain, ChevronDown, ChevronRight, Wrench, CheckCircle2, XCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import type { ThinkingEvent } from "@/lib/types";
import { useState } from "react";

interface ThinkingIndicatorProps {
  events: ThinkingEvent[];
  isStreaming: boolean;
  expanded: boolean;
  onToggle: () => void;
}

const toolIconMap: Record<string, { type: "brain" | "wrench" | "search" | "code" | "file" | "terminal" | "cpu" | "database" | "bot" | "history"; label: string }> = {
  // Memory
  memory_search: { type: "brain", label: "Searched memory" },
  memory_store: { type: "brain", label: "Saved memory" },
  knowledge_search: { type: "database", label: "Searched knowledge" },
  knowledge_store: { type: "database", label: "Stored knowledge" },
  // Soul
  read_soul: { type: "bot", label: "Read soul" },
  update_soul: { type: "bot", label: "Updated soul" },
  // History
  search_chat_history: { type: "history", label: "Searched history" },
  read_past_chat: { type: "history", label: "Read past chat" },
  list_past_chats: { type: "history", label: "Listed past chats" },
  // Web
  web_search: { type: "search", label: "Searched web" },
  web_fetch: { type: "search", label: "Fetched URL" },
  image_search: { type: "search", label: "Searched images" },
  news_search: { type: "search", label: "Searched news" },
  wikipedia_search: { type: "search", label: "Searched Wikipedia" },
  wikipedia_read: { type: "search", label: "Read Wikipedia" },
  // Code
  execute_code: { type: "code", label: "Ran code" },
  calculate: { type: "code", label: "Calculated" },
  // Virtual env
  create_env: { type: "cpu", label: "Created env" },
  run_in_env: { type: "terminal", label: "Ran command" },
  copy_from_env: { type: "cpu", label: "Copied from env" },
  kill_env: { type: "cpu", label: "Killed env" },
  list_envs: { type: "cpu", label: "Listed envs" },
  write_env_file: { type: "file", label: "Wrote env file" },
  read_env_file: { type: "file", label: "Read env file" },
  // System
  find_files: { type: "file", label: "Found files" },
  read_system_file: { type: "file", label: "Read file" },
  write_system_file: { type: "file", label: "Wrote file" },
  edit_file: { type: "file", label: "Edited file" },
  append_file: { type: "file", label: "Appended to file" },
  create_directory: { type: "file", label: "Created directory" },
  delete_file: { type: "file", label: "Deleted file" },
  move_file: { type: "file", label: "Moved file" },
  copy_file: { type: "file", label: "Copied file" },
  list_pending_changes: { type: "file", label: "Listed changes" },
  restore_file: { type: "file", label: "Restored file" },
  // Custom tools
  create_tool: { type: "wrench", label: "Created tool" },
  list_custom_tools: { type: "wrench", label: "Listed tools" },
  delete_custom_tool: { type: "wrench", label: "Deleted tool" },
  // Files
  extract_file: { type: "file", label: "Extracted file" },
  list_uploaded_files: { type: "file", label: "Listed files" },
  // Workspace
  read_file: { type: "file", label: "Read file" },
  write_file: { type: "file", label: "Wrote file" },
  list_files: { type: "file", label: "Listed files" },
  // Rich content
  create_table: { type: "file", label: "Created table" },
  embed_image: { type: "file", label: "Embedded image" },
  embed_youtube: { type: "file", label: "Embedded video" },
  embed_video: { type: "file", label: "Embedded video" },
  embed_audio: { type: "file", label: "Embedded audio" },
  embed_link_preview: { type: "file", label: "Embedded link preview" },
  generate_image: { type: "file", label: "Generated image" },
};

function getToolMeta(name: string) {
  return toolIconMap[name] || { type: "wrench" as const, label: name };
}

function formatToolArgs(name: string, args: Record<string, unknown>): string {
  if (name === "web_search") return String(args.query || "");
  if (name === "web_fetch") return String(args.url || "");
  if (name === "image_search") return String(args.query || "");
  if (name === "news_search") return String(args.query || "");
  if (name === "wikipedia_search") return String(args.query || "");
  if (name === "wikipedia_read") return String(args.title || "");
  if (name === "calculate") return String(args.expression || "");
  if (name === "execute_code") {
    const code = String(args.code || "");
    return code.length > 80 ? code.slice(0, 80) + "…" : code;
  }
  if (["read_file", "write_file", "read_system_file", "write_system_file", "read_env_file", "write_env_file", "append_file", "create_directory"].includes(name))
    return String(args.path || "");
  if (name === "edit_file") return `${args.path || ""}`;
  if (name === "delete_file") return String(args.path || "");
  if (name === "move_file" || name === "copy_file") return `${args.source || ""} → ${args.destination || ""}`;
  if (name === "list_files" || name === "find_files") return String(args.pattern || args.path || ".");
  if (name === "memory_search") return String(args.keyword || "");
  if (name === "memory_store") return `${args.key}`;
  if (name === "search_chat_history") return String(args.query || "");
  if (name === "create_env") return String(args.name || "");
  if (name === "run_in_env") return String(args.command || "");
  if (name === "extract_file") return String(args.file_id || "");
  if (name === "update_soul") return String(args.reason || "updating");
  if (name === "create_tool") return String(args.name || "");
  if (name === "create_table") return `${(args.headers as string[])?.length || 0} cols`;
  if (name === "embed_image") return String(args.query || args.url || args.file_id || "");
  if (name === "embed_youtube") return String(args.url || "");
  if (name === "embed_video" || name === "embed_audio" || name === "embed_link_preview") return String(args.url || "");
  if (name === "generate_image") return String(args.prompt || "").slice(0, 60);
  return Object.keys(args).length > 0 ? JSON.stringify(args).slice(0, 80) : "";
}

function IconForType({ type, className }: { type: string; className?: string }) {
  // Use a switch to avoid dynamic component creation lint error
  switch (type) {
    case "brain": return <Brain className={className} />;
    case "wrench": return <Wrench className={className} />;
    case "search": return <Search className={className} />;
    case "code": return <Code className={className} />;
    case "file": return <FileIcon className={className} />;
    case "terminal": return <Terminal className={className} />;
    case "cpu": return <Cpu className={className} />;
    case "database": return <Database className={className} />;
    case "bot": return <Bot className={className} />;
    case "history": return <History className={className} />;
    default: return <Wrench className={className} />;
  }
}

// Import icons used in the switch above
import { Search, Code, FileText as FileIcon, Terminal, Cpu, Database, Bot, History } from "lucide-react";

export function ThinkingIndicator({
  events,
  isStreaming,
  expanded,
  onToggle,
}: ThinkingIndicatorProps) {
  const isThinking = isStreaming && events.length === 0;
  const hasToolCalls = events.some((e) => e.type === "tool_call" || e.type === "tool_result");
  const isStillWorking = isStreaming && (events.length > 0 || isThinking);

  // Split events into:
  //  - toolEvents: tool_call + tool_result (always shown inline, never collapsed)
  //  - thinkingEvents: pure thinking text (collapsible, shown on demand)
  const toolEvents = events.filter(
    (e) => e.type === "tool_call" || e.type === "tool_result"
  );
  const thinkingEvents = events.filter((e) => e.type === "thinking");

  if (!isStillWorking && events.length === 0) return null;

  const isToolActive = events.some(
    (e) => e.type === "tool_call" && e.status === "active"
  );
  const toolCallCount = events.filter((e) => e.type === "tool_call").length;
  const hasThinkingText = thinkingEvents.length > 0;

  // Auto-expand the thinking section while streaming (so the user sees the
  // reasoning trace flow in real-time). Once streaming completes, the user
  // can collapse it manually.
  const showThinkingExpanded = expanded || (isStreaming && hasThinkingText);

  return (
    <div className="flex flex-col gap-1.5 py-2">
      {/* --- Status header (spinner + summary) --- */}
      {/* When still working OR has thinking text to toggle, make it a button. */}
      {/* When done with only tool calls, it's just a non-interactive label. */}
      {(isStillWorking || hasThinkingText) ? (
        <button
          onClick={hasThinkingText ? onToggle : undefined}
          className={cn(
            "flex items-center gap-2 rounded-lg px-2 py-0.5 transition-all w-fit",
            hasThinkingText && "hover:bg-foreground/5 cursor-pointer"
          )}
        >
          {/* Spinner / status icon */}
          {isStillWorking ? (
            isToolActive || (hasToolCalls && !hasThinkingText) ? (
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                className="flex h-3.5 w-3.5 items-center justify-center"
              >
                <Wrench className="h-3.5 w-3.5 text-foreground/70" />
              </motion.div>
            ) : (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-foreground/60" />
            )
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5 text-foreground/40" />
          )}

          {/* Summary text */}
          <span className="text-xs text-muted-foreground">
            {events.length === 0 ? (
              "Thinking…"
            ) : hasToolCalls ? (
              <>
                {isStillWorking ? "Working…" : "Done"}
                {toolCallCount > 0 && ` · ${toolCallCount} tool call${toolCallCount > 1 ? "s" : ""}`}
              </>
            ) : (
              <>{isStillWorking ? "Thinking…" : "Thought"}</>
            )}
          </span>

          {/* Expand chevron — only if there's thinking text to toggle */}
          {hasThinkingText && (
            expanded ? (
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
            )
          )}
        </button>
      ) : toolEvents.length > 0 ? (
        /* Done, only tool calls, no thinking text — minimal non-interactive header */
        <div className="flex items-center gap-2 px-2 py-0.5">
          <CheckCircle2 className="h-3.5 w-3.5 text-foreground/40" />
          <span className="text-xs text-muted-foreground">
            Done · {toolCallCount} tool call{toolCallCount > 1 ? "s" : ""}
          </span>
        </div>
      ) : null}

      {/* --- Collapsible thinking text (reasoning) --- */}
      {/* Auto-expanded while streaming so reasoning flows in real-time. */}
      <AnimatePresence>
        {hasThinkingText && showThinkingExpanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="ml-5 overflow-hidden border-l border-border/40 pl-3"
          >
            {thinkingEvents.map((event) => (
              <ThinkingEventRow key={event.id} event={event} />
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* --- Tool call list (ALWAYS visible, never collapsed) --- */}
      {toolEvents.length > 0 && (
        <div className="ml-5 space-y-0.5 border-l border-border/40 pl-3">
          {toolEvents.map((event) => (
            <ThinkingEventRow key={event.id} event={event} />
          ))}
        </div>
      )}
    </div>
  );
}

function ThinkingEventRow({ event }: { event: ThinkingEvent }) {
  const [showResult, setShowResult] = useState(false);

  if (event.type === "thinking") {
    return (
      <div className="text-xs text-muted-foreground/70 italic py-0.5 whitespace-pre-wrap break-words max-h-60 overflow-y-auto">
        {event.content}
      </div>
    );
  }

  if (event.type === "tool_call") {
    const meta = getToolMeta(event.toolName || "");
    const args = formatToolArgs(event.toolName || "", event.toolArgs || {});
    return (
      <div className="flex items-center gap-2 text-xs py-0.5">
        <IconForType type={meta.type} className="h-3 w-3 text-muted-foreground/60 flex-shrink-0" />
        <span className="text-muted-foreground">{meta.label}</span>
        {args && (
          <span className="text-foreground/60 truncate font-mono text-[0.7rem]">
            {args}
          </span>
        )}
        {event.status === "active" && (
          <Loader2 className="h-2.5 w-2.5 animate-spin text-muted-foreground/50" />
        )}
      </div>
    );
  }

  if (event.type === "tool_result") {
    const meta = getToolMeta(event.toolName || "");
    const result = event.toolResult || "";
    const isLong = result.length > 150;
    return (
      <div className="text-xs py-0.5">
        <button
          onClick={() => setShowResult(!showResult)}
          className="flex items-center gap-2 text-muted-foreground/60 hover:text-foreground/80 transition-colors"
        >
          <IconForType type={meta.type} className="h-3 w-3 flex-shrink-0" />
          <span className="italic">→ result</span>
          {isLong && (
            showResult ? <ChevronDown className="h-2.5 w-2.5" /> : <ChevronRight className="h-2.5 w-2.5" />
          )}
        </button>
        {showResult && isLong && (
          <pre className="mt-1 ml-5 whitespace-pre-wrap break-words font-mono text-[0.65rem] text-muted-foreground/60 max-h-40 overflow-y-auto">
            {result}
          </pre>
        )}
        {!isLong && result && (
          <span className="ml-5 text-muted-foreground/50 font-mono text-[0.65rem]">
            {result.slice(0, 100)}
          </span>
        )}
      </div>
    );
  }

  return null;
}
