// src/components/chat/block-rows.tsx
"use client";

import { useState, useMemo } from "react";
import { Loader2, ChevronDown, ChevronRight } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import type { ToolCall, ToolResult, ContentBlock } from "@/lib/types";
import {
  Brain, Wrench, Search, Code, FileText as FileIcon, Terminal,
  Cpu, Database, Bot, History, CheckCircle2, Layers,
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
  image_search: { type: "search", label: "Searched images" },
  news_search: { type: "search", label: "Searched news" },
  wikipedia_search: { type: "search", label: "Searched Wikipedia" },
  wikipedia_read: { type: "search", label: "Read Wikipedia" },
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
  edit_file: { type: "file", label: "Edited file" },
  append_file: { type: "file", label: "Appended to file" },
  create_directory: { type: "file", label: "Created directory" },
  delete_file: { type: "file", label: "Deleted file" },
  move_file: { type: "file", label: "Moved file" },
  copy_file: { type: "file", label: "Copied file" },
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
  embed_youtube: { type: "file", label: "Embedded video" },
  embed_video: { type: "file", label: "Embedded video" },
  embed_audio: { type: "file", label: "Embedded audio" },
  embed_link_preview: { type: "file", label: "Embedded link preview" },
  generate_image: { type: "file", label: "Generated image" },
  get_tools: { type: "wrench", label: "Requested tools" },
};

function getToolMeta(name: string) {
  return toolIconMap[name] || { type: "wrench", label: name };
}

// Classify a tool name into a high-level "phase" so we can summarize groups
// of tool calls with a short, user-facing description like "Searching for
// information" or "Reading files". This drives the auto-collapse grouping.
//
// Phases are mutually exclusive — a tool maps to exactly one phase. The
// order of checks matters: more specific phases are checked first.
export function getPhaseForTool(name: string): {
  phase: string;
  label: string;
  iconType: string;
} {
  // Information gathering
  if (
    [
      "web_search",
      "web_fetch",
      "image_search",
      "news_search",
      "wikipedia_search",
      "wikipedia_read",
    ].includes(name)
  ) {
    return { phase: "searching", label: "Searching for information", iconType: "search" };
  }
  // Memory & history
  if (
    [
      "memory_search",
      "memory_store",
      "search_chat_history",
      "read_past_chat",
      "list_past_chats",
      "knowledge_search",
      "knowledge_store",
    ].includes(name)
  ) {
    return { phase: "recalling", label: "Recalling memory & history", iconType: "brain" };
  }
  // File operations (workspace + system)
  if (
    [
      "read_file",
      "read_system_file",
      "read_env_file",
      "list_files",
      "find_files",
      "extract_file",
      "list_uploaded_files",
    ].includes(name)
  ) {
    return { phase: "reading", label: "Reading files", iconType: "file" };
  }
  if (
    [
      "write_file",
      "write_system_file",
      "write_env_file",
      "edit_file",
      "append_file",
      "create_directory",
      "delete_file",
      "move_file",
      "copy_file",
    ].includes(name)
  ) {
    return { phase: "writing", label: "Creating & editing files", iconType: "file" };
  }
  if (["list_pending_changes", "restore_file"].includes(name)) {
    return { phase: "managing", label: "Managing file changes", iconType: "file" };
  }
  // Code & computation
  if (["execute_code", "calculate"].includes(name)) {
    return { phase: "computing", label: "Running code", iconType: "code" };
  }
  // Virtual environments
  if (
    [
      "create_env",
      "run_in_env",
      "copy_from_env",
      "kill_env",
      "list_envs",
    ].includes(name)
  ) {
    return { phase: "building", label: "Building & running", iconType: "cpu" };
  }
  // Custom tools
  if (["create_tool", "list_custom_tools", "delete_custom_tool"].includes(name)) {
    return { phase: "extending", label: "Extending capabilities", iconType: "wrench" };
  }
  // Soul & personality
  if (["read_soul", "update_soul"].includes(name)) {
    return { phase: "reflecting", label: "Reflecting on identity", iconType: "bot" };
  }
  // Rich content (rendered inline — these are usually terminal, not grouped)
  if (
    [
      "create_table",
      "embed_image",
      "embed_youtube",
      "embed_video",
      "embed_audio",
      "embed_link_preview",
      "generate_image",
    ].includes(name)
  ) {
    return { phase: "rendering", label: "Creating rich content", iconType: "file" };
  }
  // Default
  return { phase: "working", label: "Working", iconType: "wrench" };
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
  if (name === "create_table") return `${(args.headers as string[])?.length || 0} cols`;
  if (name === "embed_image") return String(args.query || args.url || args.file_id || "");
  if (name === "embed_youtube") return String(args.url || "");
  if (name === "embed_video" || name === "embed_audio" || name === "embed_link_preview") return String(args.url || "");
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
  // Default to expanded so the reasoning content is always visible on
  // initial render (both during streaming AND after page reload).
  // The user can collapse it manually.
  const [expanded, setExpanded] = useState(true);

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

// ---------- Phase grouping ----------
//
// When the assistant runs 5+ consecutive "action" blocks (thinking +
// tool_call + tool_result, possibly interspersed with short text
// explanations), we collapse them all into a single header that summarizes
// the phase (e.g. "Searching for information"). Clicking the header expands
// the full list with all the individual rows rendered as before.
//
// The grouping algorithm:
//   1. Walk the blocks list.
//   2. Collect a run of consecutive "action" blocks (thinking / tool_call /
//      tool_result, OR a short text block <= 120 chars that reads like an
//      "I'm doing X" explanation).
//   3. If the run reaches >= 5 blocks, collapse them into a PhaseGroup.
//   4. Otherwise, render each block inline as before.
//   5. If a long text block (> 120 chars) appears in the middle of a run,
//      it breaks the run — long text is treated as "real response content"
//      and rendered outside the group.
//
// The phase label is derived from the FIRST tool_call in the run (or
// "Reasoning" if the run starts with thinking blocks and has no tool calls).

const MIN_BLOCKS_TO_COLLAPSE = 5;
const SHORT_TEXT_THRESHOLD = 120; // chars

function isActionBlock(b: ContentBlock): boolean {
  return b.type === "thinking" || b.type === "tool_call" || b.type === "tool_result";
}

function isShortExplanationText(b: ContentBlock): boolean {
  if (b.type !== "text" || !b.content) return false;
  const trimmed = b.content.trim();
  if (trimmed.length === 0 || trimmed.length > SHORT_TEXT_THRESHOLD) return false;
  // Heuristic: short text that doesn't end with sentence-ending punctuation
  // is likely an "I'm doing X" explanation rather than real response content.
  // (e.g. "Let me search for that." → grouped; "Here's what I found:" → grouped)
  // If the text contains a paragraph break, it's real content — don't group.
  if (trimmed.includes("\n\n")) return false;
  // If the text starts with a markdown header/image/table, it's real content.
  if (/^(#{1,6}\s|!\[|\|)/m.test(trimmed)) return false;
  return true;
}

/**
 * Decide whether a block is a "groupable action" — i.e. a thinking block,
 * a tool call, a tool result, or a short text explanation that sits between
 * tool calls. Long text blocks (real response content) return false and act
 * as group boundaries.
 */
function isGroupable(b: ContentBlock): boolean {
  return isActionBlock(b) || isShortExplanationText(b);
}

/**
 * Given a list of blocks, partition them into segments. Each segment is
 * either a single "ungroupable" block (rendered standalone) or a run of
 * groupable blocks. Runs of >= MIN_BLOCKS_TO_COLLAPSE blocks become a
 * PhaseGroup; shorter runs are rendered as individual blocks (no grouping).
 */
export function partitionBlocksForPhases(blocks: ContentBlock[]): Array<
  | { kind: "single"; block: ContentBlock }
  | { kind: "group"; blocks: ContentBlock[]; phase: string; label: string; iconType: string }
> {
  const segments: Array<
    | { kind: "single"; block: ContentBlock }
    | { kind: "group"; blocks: ContentBlock[]; phase: string; label: string; iconType: string }
  > = [];

  let run: ContentBlock[] = [];
  const flushRun = () => {
    if (run.length === 0) return;
    if (run.length >= MIN_BLOCKS_TO_COLLAPSE) {
      // Determine the phase from the first tool_call in the run, or default
      // to "Reasoning" if the run is all thinking blocks.
      const firstToolCall = run.find((b) => b.type === "tool_call");
      const phase = firstToolCall?.toolCall
        ? getPhaseForTool(firstToolCall.toolCall.name)
        : { phase: "reasoning", label: "Reasoning", iconType: "brain" };
      segments.push({
        kind: "group",
        blocks: run,
        phase: phase.phase,
        label: phase.label,
        iconType: phase.iconType,
      });
    } else {
      // Too few to collapse — emit each block as a single
      for (const b of run) segments.push({ kind: "single", block: b });
    }
    run = [];
  };

  for (const b of blocks) {
    if (isGroupable(b)) {
      run.push(b);
    } else {
      // Long text or other content — flush the run, then emit this block.
      flushRun();
      segments.push({ kind: "single", block: b });
    }
  }
  flushRun();

  return segments;
}

/**
 * A collapsed phase group. Shows a single summary row with an icon, the
 * phase label, and a count of actions. Clicking expands to reveal all the
 * individual blocks (thinking rows, tool call rows, tool result rows)
 * rendered exactly as they would be outside the group.
 */
export function PhaseGroup({
  blocks,
  label,
  iconType,
  isStreaming,
  defaultExpanded = false,
}: {
  blocks: ContentBlock[];
  label: string;
  iconType: string;
  isStreaming: boolean;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  // Count distinct tool calls (each tool_call + its tool_result = 1 action)
  const toolCallCount = blocks.filter((b) => b.type === "tool_call").length;
  const thinkingCount = blocks.filter((b) => b.type === "thinking").length;
  const actionCount = toolCallCount + thinkingCount;

  // Check if any tool call in the group is still active (streaming)
  const hasActive = blocks.some(
    (b) => (b.type === "tool_call" || b.type === "thinking") && b.status === "active"
  );

  return (
    <div className="my-1 rounded-lg border border-border/30 bg-foreground/[0.02]">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground hover:bg-foreground/[0.03] transition-colors"
      >
        <motion.div
          animate={hasActive && isStreaming ? { rotate: 360 } : {}}
          transition={hasActive && isStreaming ? { duration: 2, repeat: Infinity, ease: "linear" } : {}}
          className="flex h-3.5 w-3.5 items-center justify-center flex-shrink-0"
        >
          {hasActive && isStreaming ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-foreground/50" />
          ) : (
            <IconForType type={iconType} className="h-3.5 w-3.5 text-foreground/40" />
          )}
        </motion.div>
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground/60">
          {actionCount > 0 && (
            <>
              {" · "}
              {toolCallCount > 0 && `${toolCallCount} tool call${toolCallCount > 1 ? "s" : ""}`}
              {toolCallCount > 0 && thinkingCount > 0 && ", "}
              {thinkingCount > 0 && `${thinkingCount} thought${thinkingCount > 1 ? "s" : ""}`}
            </>
          )}
        </span>
        <span className="ml-auto">
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </span>
      </button>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-2 pb-2 pt-0.5 space-y-0.5">
              {blocks.map((block, idx) => {
                if (block.type === "thinking" && block.content) {
                  return <ThinkingRow key={idx} content={block.content} isStreaming={isStreaming && block.status === "active"} />;
                }
                if (block.type === "tool_call" && block.toolCall) {
                  return <ToolCallRow key={idx} toolCall={block.toolCall} status={block.status} />;
                }
                if (block.type === "tool_result" && block.toolResult) {
                  return <ToolResultRow key={idx} toolResult={block.toolResult} />;
                }
                if (block.type === "text" && block.content) {
                  // Short explanation text — render inline as muted italic
                  return (
                    <div key={idx} className="text-xs italic text-muted-foreground/50 px-2 py-0.5">
                      {block.content.trim()}
                    </div>
                  );
                }
                return null;
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
