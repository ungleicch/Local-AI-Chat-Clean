// src/components/chat/file-panel.tsx
"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  FileText, Folder, FolderOpen, ChevronRight, ChevronDown,
  RefreshCw, X, FileCode, FileJson, FileTerminal, FileImage,
  Plus, Edit3, Upload, Loader2,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { FileWriteEvent } from "@/lib/types";

// ---------- Types ----------

interface WorkspaceFileEntry {
  path: string;
  name: string;
  size: number;
  isDirectory: boolean;
  modifiedAt: string;
  extension?: string;
}

interface FilePanelProps {
  conversationId: string | null;
  // File-write events from the SSE stream. When a new event arrives, the
  // panel auto-selects that file and displays its content.
  fileWriteEvents: FileWriteEvent[];
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

// ---------- File icon helper ----------

function getFileIcon(entry: WorkspaceFileEntry, className?: string) {
  if (entry.isDirectory) {
    return <Folder className={className} />;
  }
  const ext = (entry.extension || "").toLowerCase();
  // Code files
  if (["ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "rb", "go", "rs", "java", "c", "cpp", "cs", "swift", "kt", "php"].includes(ext)) {
    return <FileCode className={className} />;
  }
  // JSON / config
  if (["json", "yaml", "yml", "toml", "ini", "env", "xml"].includes(ext)) {
    return <FileJson className={className} />;
  }
  // Shell / scripts
  if (["sh", "bash", "zsh", "fish", "ps1", "bat"].includes(ext)) {
    return <FileTerminal className={className} />;
  }
  // Images
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"].includes(ext)) {
    return <FileImage className={className} />;
  }
  return <FileText className={className} />;
}

// ---------- Tree builder ----------

interface TreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: TreeNode[];
  size?: number;
  modifiedAt?: string;
  extension?: string;
}

/**
 * Build a nested tree from a flat list of file entries.
 * Directories are created implicitly from file paths.
 */
function buildTree(entries: WorkspaceFileEntry[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", isDirectory: true, children: [] };

  for (const entry of entries) {
    const parts = entry.path.split("/");
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const partPath = parts.slice(0, i + 1).join("/");
      let child = current.children?.find((c) => c.name === part);
      if (!child) {
        child = {
          name: part,
          path: partPath,
          isDirectory: !isLast || entry.isDirectory,
          children: [],
        };
        current.children!.push(child);
      }
      if (isLast) {
        child.isDirectory = entry.isDirectory;
        child.size = entry.size;
        child.modifiedAt = entry.modifiedAt;
        child.extension = entry.extension;
        if (!entry.isDirectory) {
          child.children = undefined;
        }
      }
      current = child;
    }
  }

  // Sort: directories first, then files, alphabetically
  const sortRecursive = (node: TreeNode) => {
    if (!node.children) return;
    node.children.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    node.children.forEach(sortRecursive);
  };
  sortRecursive(root);

  return root.children || [];
}

// ---------- Tree node component ----------

function TreeView({
  nodes,
  selectedPath,
  onSelect,
  expandedDirs,
  onToggleDir,
  depth = 0,
}: {
  nodes: TreeNode[];
  selectedPath: string | null;
  onSelect: (node: TreeNode) => void;
  expandedDirs: Set<string>;
  onToggleDir: (path: string) => void;
  depth?: number;
}) {
  return (
    <div className="space-y-0.5">
      {nodes.map((node) => {
        const isSelected = selectedPath === node.path;
        const isExpanded = expandedDirs.has(node.path);
        return (
          <div key={node.path}>
            <button
              onClick={() => {
                if (node.isDirectory) {
                  onToggleDir(node.path);
                } else {
                  onSelect(node);
                }
              }}
              className={cn(
                "flex items-center gap-1.5 w-full text-left px-1.5 py-1 rounded text-xs hover:bg-foreground/[0.05] transition-colors",
                isSelected && "bg-foreground/[0.08] text-foreground",
                !isSelected && "text-muted-foreground"
              )}
              style={{ paddingLeft: `${depth * 12 + 6}px` }}
            >
              {node.isDirectory ? (
                <>
                  {isExpanded ? (
                    <ChevronDown className="h-3 w-3 flex-shrink-0 opacity-60" />
                  ) : (
                    <ChevronRight className="h-3 w-3 flex-shrink-0 opacity-60" />
                  )}
                  {isExpanded ? (
                    <FolderOpen className="h-3.5 w-3.5 flex-shrink-0 text-foreground/50" />
                  ) : (
                    <Folder className="h-3.5 w-3.5 flex-shrink-0 text-foreground/50" />
                  )}
                </>
              ) : (
                <>
                  <span className="w-3 flex-shrink-0" />
                  {getFileIcon(node as unknown as WorkspaceFileEntry, "h-3.5 w-3.5 flex-shrink-0 text-muted-foreground/70")}
                </>
              )}
              <span className="truncate flex-1">{node.name}</span>
              {node.size !== undefined && !node.isDirectory && node.size > 0 && (
                <span className="text-[0.6rem] text-muted-foreground/40 flex-shrink-0">
                  {formatSize(node.size)}
                </span>
              )}
            </button>
            {node.isDirectory && isExpanded && node.children && node.children.length > 0 && (
              <TreeView
                nodes={node.children}
                selectedPath={selectedPath}
                onSelect={onSelect}
                expandedDirs={expandedDirs}
                onToggleDir={onToggleDir}
                depth={depth + 1}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

// ---------- Main FilePanel component ----------

export function FilePanel({
  conversationId,
  fileWriteEvents,
  isOpen,
  onOpenChange,
}: FilePanelProps) {
  const [files, setFiles] = useState<WorkspaceFileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>("");
  const [fileLoading, setFileLoading] = useState(false);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [writeIndicator, setWriteIndicator] = useState<{
    operation: string;
    path: string;
  } | null>(null);
  // Track the last file-write event we've processed so we don't re-select
  // files on every re-render.
  const lastProcessedEventIdx = useRef(-1);

  // ---------- Load file list ----------
  const loadFiles = useCallback(async () => {
    if (!conversationId) {
      setFiles([]);
      return;
    }
    setLoading(true);
    try {
      const resp = await fetch(`/api/workspace/files?conversationId=${encodeURIComponent(conversationId)}`);
      if (!resp.ok) {
        setFiles([]);
        return;
      }
      const data = await resp.json();
      setFiles(data.files || []);
    } catch {
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  // Reload when conversation changes
  useEffect(() => {
    loadFiles();
    setSelectedPath(null);
    setFileContent("");
    setExpandedDirs(new Set());
  }, [conversationId, loadFiles]);

  // ---------- Load file content ----------
  const loadFileContent = useCallback(
    async (path: string) => {
      if (!conversationId) return;
      setFileLoading(true);
      try {
        const resp = await fetch(
          `/api/workspace/file?conversationId=${encodeURIComponent(conversationId)}&path=${encodeURIComponent(path)}`
        );
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          setFileContent(`(Could not load file: ${err.error || resp.statusText})`);
          return;
        }
        const data = await resp.json();
        setFileContent(data.content || "");
      } catch (e) {
        setFileContent(`(Error loading file: ${(e as Error).message})`);
      } finally {
        setFileLoading(false);
      }
    },
    [conversationId]
  );

  // ---------- Handle file selection ----------
  const handleSelect = useCallback(
    (node: TreeNode) => {
      if (node.isDirectory) return;
      setSelectedPath(node.path);
      loadFileContent(node.path);
    },
    [loadFileContent]
  );

  const handleToggleDir = useCallback((path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  // ---------- React to file-write events ----------
  // When a new file_write event arrives, auto-select that file and show
  // its content. Also refresh the file tree so the new file appears.
  useEffect(() => {
    if (fileWriteEvents.length === 0) return;
    // Only process events that are newer than what we've already handled
    const newEvents = fileWriteEvents.slice(lastProcessedEventIdx.current + 1);
    if (newEvents.length === 0) return;
    lastProcessedEventIdx.current = fileWriteEvents.length - 1;

    const latest = newEvents[newEvents.length - 1];
    // The path in the event is absolute (resolved server-side). We need
    // to convert it to a workspace-relative path for display + selection.
    let displayPath = latest.path;
    // Try to make it relative to the workspace root
    // (we don't know the exact workspace root on the client, but we can
    // heuristically strip everything up to and including the conversationId)
    const convIdIdx = displayPath.indexOf(conversationId || "");
    if (convIdIdx >= 0) {
      displayPath = displayPath.slice(convIdIdx + (conversationId || "").length + 1);
    }

    // Show a brief write indicator
    setWriteIndicator({ operation: latest.operation, path: displayPath });
    const indicatorTimer = setTimeout(() => setWriteIndicator(null), 2500);

    // Auto-select the file and display its content (from the event, not a refetch)
    setSelectedPath(displayPath);
    setFileContent(latest.content);

    // Refresh the file tree so the new file appears
    // (debounced — multiple writes in quick succession shouldn't spam the API)
    const refreshTimer = setTimeout(() => {
      loadFiles();
    }, 300);

    return () => {
      clearTimeout(indicatorTimer);
      clearTimeout(refreshTimer);
    };
  }, [fileWriteEvents, conversationId, loadFiles]);

  // ---------- Build tree ----------
  const tree = buildTree(files);

  // ---------- Auto-expand directories that contain the selected file ----------
  useEffect(() => {
    if (!selectedPath) return;
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      const parts = selectedPath.split("/");
      for (let i = 1; i < parts.length; i++) {
        next.add(parts.slice(0, i).join("/"));
      }
      return next;
    });
  }, [selectedPath]);

  if (!isOpen) return null;

  return (
    <motion.div
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: "auto", opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="flex h-full border-l border-border bg-card/30 overflow-hidden flex-shrink-0"
    >
      <div className="flex h-full w-[400px] flex-col">
        {/* ---------- Header ---------- */}
        <div className="flex items-center gap-2 border-b border-border px-3 py-2 flex-shrink-0">
          <FileText className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium text-foreground">Workspace Files</span>
          <span className="text-[0.65rem] text-muted-foreground/60">
            {files.filter((f) => !f.isDirectory).length} files
          </span>
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              onClick={loadFiles}
              disabled={loading}
              title="Refresh"
            >
              <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              onClick={() => onOpenChange(false)}
              title="Close panel"
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        </div>

        {/* ---------- Write indicator (transient) ---------- */}
        <AnimatePresence>
          {writeIndicator && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="flex items-center gap-1.5 px-3 py-1 bg-foreground/[0.04] border-b border-border/30 flex-shrink-0 overflow-hidden"
            >
              {writeIndicator.operation === "create" ? (
                <Plus className="h-3 w-3 text-green-500 flex-shrink-0" />
              ) : writeIndicator.operation === "edit" ? (
                <Edit3 className="h-3 w-3 text-blue-500 flex-shrink-0" />
              ) : (
                <Upload className="h-3 w-3 text-amber-500 flex-shrink-0" />
              )}
              <span className="text-[0.65rem] text-muted-foreground truncate">
                {writeIndicator.operation === "create"
                  ? "Created"
                  : writeIndicator.operation === "edit"
                  ? "Edited"
                  : "Updated"}{" "}
                <span className="font-mono">{writeIndicator.path}</span>
              </span>
              <Loader2 className="h-2.5 w-2.5 animate-spin text-muted-foreground/50 ml-auto flex-shrink-0" />
            </motion.div>
          )}
        </AnimatePresence>

        {/* ---------- Split: file tree (left) + content (right) ---------- */}
        <div className="flex flex-1 min-h-0">
          {/* File tree */}
          <div className="w-[180px] flex-shrink-0 overflow-y-auto border-r border-border/30 p-1.5">
            {loading && files.length === 0 ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-3 w-3 animate-spin text-muted-foreground/50" />
              </div>
            ) : files.length === 0 ? (
              <div className="text-[0.7rem] text-muted-foreground/40 italic px-2 py-4 text-center">
                No files yet.
                <br />
                The AI&apos;s created files will appear here.
              </div>
            ) : (
              <TreeView
                nodes={tree}
                selectedPath={selectedPath}
                onSelect={handleSelect}
                expandedDirs={expandedDirs}
                onToggleDir={handleToggleDir}
              />
            )}
          </div>

          {/* File content */}
          <div className="flex-1 min-w-0 flex flex-col">
            {selectedPath ? (
              <>
                <div className="flex items-center gap-1.5 px-2 py-1 border-b border-border/30 bg-foreground/[0.02] flex-shrink-0">
                  {getFileIcon(
                    {
                      path: selectedPath,
                      name: selectedPath.split("/").pop() || "",
                      size: 0,
                      isDirectory: false,
                      modifiedAt: "",
                      extension: selectedPath.includes(".")
                        ? "." + selectedPath.split(".").pop()
                        : undefined,
                    },
                    "h-3 w-3 text-muted-foreground/70 flex-shrink-0"
                  )}
                  <span className="text-[0.7rem] font-mono text-muted-foreground truncate flex-1">
                    {selectedPath}
                  </span>
                </div>
                <div className="flex-1 overflow-auto">
                  {fileLoading ? (
                    <div className="flex items-center justify-center py-4">
                      <Loader2 className="h-3 w-3 animate-spin text-muted-foreground/50" />
                    </div>
                  ) : (
                    <pre className="text-[0.7rem] font-mono text-foreground/80 p-2 whitespace-pre-wrap break-words leading-relaxed">
                      {fileContent || "(empty file)"}
                    </pre>
                  )}
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-[0.7rem] text-muted-foreground/40 italic p-4 text-center">
                Select a file to view its contents.
                <br />
                When the AI writes a file, it&apos;ll open here automatically.
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
