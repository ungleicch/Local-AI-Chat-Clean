"use client";

import { useState } from "react";
import { Loader2, ChevronDown, ChevronRight } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import type { ToolCall, ToolResult } from "@/lib/types";
import {
  Brain, Wrench, Search, Code, FileText as FileIcon, Terminal,
  Cpu, Database, Bot, History, CheckCircle2,
} from "lucide-react";

// Tool icon + label map (shared with thinking-indicator)
const toolIconMap: Record<string, { type: string; label: string }> = {
  memory_search: { type: "brain", label: "Searched memory" },
  memory_store: { type: "brain", label: "Saved memory" },
  knowledge_search: { type: "database", label: "Searched knowledge" },
  knowledge_store: { type: "database", label: "Stored knowledge" },
  read_soul: { type: "bot", label: "Read soul" },
  update_soul: { type: "bot", label: "Updated soul" },
  search_chat_history: { type: "history", label: "Searched history" },
  read_past_chat: { type: "history", label: "Read past chat" },
  list_past_chats: { type: "history", label: "Listed past chats" },
  web_search: { type: "search", label: "Searched web" },
  web_fetch: { type: "search", label: "Fetched URL" },
  execute_code: { type: "code", label: "Ran code" },
  calculate: { type: "code", label: "Calculated" },
  create_env: { type: "cpu", label: "Created env" },
  run_in_env: { type: "terminal", label: "Ran command" },
  copy_from_env: { type: "cpu", label: "Copied from env" },
  kill_env: { type: "cpu", label: "Killed env" },
  list_envs: { type: "cpu", label: "Listed envs" },
  write_env_file: { type: "file", label: "Wrote env file" },
  read_env_file: { type: "file", label: "Read env file" },
  find_files: { type: "file", label: "Found files" },
  read_system_file: { type: "file", label: "Read file" },
  write_system_file: { type: "file", label: "Wrote file" },
  list_pending_changes: { type: "file", label: "Listed changes" },
  restore_file: { type: "file", label: "Restored file" },
  create_tool: { type: "wrench", label: "Created tool" },
  list_custom_tools: { type: "wrench", label: "Listed tools" },
  delete_custom_tool: { type: "wrench", label: "Deleted tool" },
  extract_file: { type: "file", label: "Extracted file" },
  list_uploaded_files: { type: "file", label: "Listed files" },
  read_file: { type: "file", label: "Read file" },
  write_file: { type: "file", label: "Wrote file" },
  list_files: { type: "file", label: "Listed files" },
  create_table: { type: "file", label: "Created table" },
  embed_image: { type: "file", label: "Embedded image" },
  generate_image: { type: "file", label: "Generated image" },
  get_tools: { type: "wrench", label: "Requested tools" },
};

function getToolMeta(name: string) {
  return toolIconMap[name] || { type: "wrench", label: name };
}

function formatToolArgs(name: string, args: Record<string, unknown>): string {
  if (name === "web_search") return String(args.query || "");
  if (name === "web_fetch") return String(args.url || "");
  if (name === "calculate") return String(args.expression || "");
  if (name === "execute_code") {
    const code = String(args.code || "");
    return code.length > 80 ? code.slice(0, 80) + "…" : code;
  }
  if (["read_file", "write_file", "read_system_file", "write_system_file", "read_env_file", "write_env_file"].includes(name))
    return String(args.path || "");
  if (name === "list_files" || name === "find_files") return String(args.pattern || args.path || ".");
  if (name === "memory_search") return String(args.keyword || "");
  if (name === "memory_store") return `${args.key}`;
  if (name === "search_chat_history") return String(args.query || "");
  if (name === "create_env") return String(args.name || "");
  if (name === "run_in_env") return String(args.command || "");
  if (name === "extract_file") return String(args.file_id || "");
  if (name === "create_table") return `${(args.headers as string[])?.length || 0} cols`;
  if (name === "embed_image") return String(args.query || args.url || args.file_id || "");
  if (name === "generate_image") return String(args.prompt || "").slice(0, 60);
  return Object.keys(args).length > 0 ? JSON.stringify(args).slice(0, 80) : "";
}

function IconForType({ type, className }: { type: string; className?: string }) {
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

/** A tool call rendered as an inline block in the interleaved flow. */
export function ToolCallRow({
  toolCall,
  status,
}: {
  toolCall: ToolCall;
  status?: string;
}) {
  const meta = getToolMeta(toolCall.name);
  const args = formatToolArgs(toolCall.name, toolCall.arguments);
  const isActive = status === "active";

  return (
    <div className="flex items-center gap-2 text-xs py-1 my-1 px-2 rounded-lg bg-foreground/[0.03] border border-border/30">
      <IconForType type={meta.type} className="h-3.5 w-3.5 text-muted-foreground/70 flex-shrink-0" />
      <span className="text-muted-foreground font-medium">{meta.label}</span>
      {args && (
        <span className="text-foreground/60 truncate font-mono text-[0.7rem] flex-1 min-w-0">
          {args}
        </span>
      )}
      {isActive ? (
        <Loader2 className="h-3 w-3 animate-spin text-muted-foreground/50 flex-shrink-0" />
      ) : (
        <CheckCircle2 className="h-3 w-3 text-foreground/30 flex-shrink-0" />
      )}
    </div>
  );
}

/** A tool result rendered as a collapsible inline block. */
export function ToolResultRow({ toolResult }: { toolResult: ToolResult }) {
  const [showResult, setShowResult] = useState(false);
  const meta = getToolMeta(toolResult.name);
  const result = toolResult.content || "";
  const isLong = result.length > 150;

  return (
    <div className="text-xs py-0.5 my-1">
      <button
        onClick={() => isLong && setShowResult(!showResult)}
        className={cn(
          "flex items-center gap-2 text-muted-foreground/60 hover:text-foreground/80 transition-colors",
          isLong && "cursor-pointer"
        )}
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
          {result.slice(0, 120)}
        </span>
      )}
    </div>
  );
}

/** A thinking/reasoning block rendered as a collapsible inline section. */
export function ThinkingRow({
  content,
  isStreaming,
}: {
  content: string;
  isStreaming: boolean;
}) {
  const [expanded, setExpanded] = useState(isStreaming);

  return (
    <div className="my-1 rounded-lg border border-border/30 bg-foreground/[0.02]">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground hover:bg-foreground/[0.03] transition-colors"
      >
        <motion.div
          animate={isStreaming ? { rotate: 360 } : {}}
          transition={isStreaming ? { duration: 2, repeat: Infinity, ease: "linear" } : {}}
          className="flex h-3.5 w-3.5 items-center justify-center flex-shrink-0"
        >
          {isStreaming ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-foreground/50" />
          ) : (
            <Brain className="h-3.5 w-3.5 text-foreground/40" />
          )}
        </motion.div>
        <span>Reasoning</span>
        <span className="ml-auto">
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </span>
      </button>
      {expanded && (
        <div className="px-3 pb-3 pt-0.5 text-xs leading-relaxed text-muted-foreground/70 italic whitespace-pre-wrap break-words max-h-60 overflow-y-auto">
          {content}
        </div>
      )}
    </div>
  );
}
