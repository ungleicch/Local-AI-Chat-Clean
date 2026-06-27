"use client";

import { Loader2, Brain, ChevronDown, ChevronRight, Wrench, CheckCircle2, XCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import type { ThinkingEvent } from "@/lib/types";
import { useState } from "react";
import { createElement } from "react";

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
};

function getToolMeta(name: string) {
  return toolIconMap[name] || { type: "wrench" as const, label: name };
}

function formatToolArgs(name: string, args: Record<string, unknown>): string {
  if (name === "web_search") return String(args.query || "");
  if (name === "web_fetch") return String(args.url || "");
  if (name === "calculate") return String(args.expression || "");
  if (name === "execute_code") {
    const code = String(args.code || "");
    return code.length > 80 ? code.slice(0, 80) + "…" : code;
  }
  if (name === "read_file" || name === "write_file" || name === "read_system_file" || name === "write_system_file" || name === "read_env_file" || name === "write_env_file")
    return String(args.path || "");
  if (name === "list_files" || name === "find_files") return String(args.pattern || args.path || ".");
  if (name === "memory_search") return String(args.keyword || "");
  if (name === "memory_store") return `${args.key}`;
  if (name === "search_chat_history") return String(args.query || "");
  if (name === "create_env") return String(args.name || "");
  if (name === "run_in_env") return String(args.command || "");
  if (name === "extract_file") return String(args.file_id || "");
  if (name === "update_soul") return String(args.reason || "updating");
  if (name === "create_tool") return String(args.name || "");
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

  if (!isStillWorking && events.length === 0) return null;

  // Determine spinner state
  // - Just starting (no events): spinner alone
  // - Thinking text coming in: spinner + click to expand thinking
  // - Tool use: different spinner + click to expand tool calls
  const isToolActive = events.some(
    (e) => e.type === "tool_call" && e.status === "active"
  );
  const lastEvent = events[events.length - 1];

  return (
    <div className="flex items-start gap-2 py-2">
      {/* Clickable spinner + summary */}
      <button
        onClick={onToggle}
        className={cn(
          "flex items-center gap-2 rounded-lg px-2 py-1 transition-all",
          "hover:bg-foreground/5",
          events.length > 0 && "cursor-pointer"
        )}
      >
        {/* Spinner */}
        {isStillWorking ? (
          isToolActive || hasToolCalls ? (
            // Tool use spinner — different color/symbol
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
              className="flex h-3.5 w-3.5 items-center justify-center"
            >
              <Wrench className="h-3.5 w-3.5 text-foreground/70" />
            </motion.div>
          ) : (
            // Thinking spinner
            <Loader2 className="h-3.5 w-3.5 animate-spin text-foreground/60" />
          )
        ) : (
          <CheckCircle2 className="h-3.5 w-3.5 text-foreground/40" />
        )}

        {/* Summary text */}
        {events.length === 0 ? (
          <span className="text-xs text-muted-foreground">Thinking…</span>
        ) : (
          <span className="text-xs text-muted-foreground">
            {hasToolCalls ? (
              <>
                {isStillWorking ? "Working…" : "Done"} ·{" "}
                {events.filter((e) => e.type === "tool_call").length} tool calls
              </>
            ) : (
              <>{isStillWorking ? "Thinking…" : "Thought"}</>
            )}
          </span>
        )}

        {/* Expand chevron */}
        {events.length > 0 && (
          expanded ? (
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3 w-3 text-muted-foreground" />
          )
        )}
      </button>

      {/* Expanded list */}
      <AnimatePresence>
        {expanded && events.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="flex-1 min-w-0 overflow-hidden"
          >
            <div className="space-y-1 ml-5 border-l border-border/40 pl-3">
              {events.map((event) => (
                <ThinkingEventRow key={event.id} event={event} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ThinkingEventRow({ event }: { event: ThinkingEvent }) {
  const [showResult, setShowResult] = useState(false);

  if (event.type === "thinking") {
    return (
      <div className="text-xs text-muted-foreground/70 italic py-0.5">
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
