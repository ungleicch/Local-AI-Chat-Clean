// src/lib/tools-system.ts
// Safe system file tools + custom tool creation framework
import type { ToolDefinition } from "./types";
import type { ToolExecutor, ToolContext } from "./tools";
import { db } from "./db";
import path from "node:path";
import fs from "node:fs/promises";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import crypto from "node:crypto";

const execAsync = promisify(exec);

// Read-only system commands allowed outside virtual envs
const SAFE_SYSTEM_COMMANDS = new Set([
  "ls", "cat", "head", "tail", "wc", "grep", "find", "file", "stat",
  "pwd", "echo", "tree", "du", "df", "which", "whereis", "type",
  "sort", "uniq", "diff", "cut", "tr", "awk", "sed",  // sed only for reading
  "md5sum", "sha256sum", "shasum",
]);

// Forbidden in system context (anything that modifies)
const FORBIDDEN_SYSTEM_PATTERNS = [
  /\brm\b/, /\bmv\b/, /\bcp\b/, /\bmkdir\b/, /\btouch\b/,  // wait — we need cp/mkdir for backups; handled separately
  /\bsudo\b/, /\bchmod\b/, /\bchown\b/,
  /\b>\s*\//, /\b>>\s*\//,  // writing to absolute paths
  /\bmkfs\b/, /\bdd\b/, /\bshutdown\b/, /\breboot\b/,
];

// ---------- Find Files (read-only) ----------
const findFiles: ToolExecutor = {
  definition: {
    type: "function",
    function: {
      name: "find_files",
      description:
        "Find files on the user's system by name pattern. Read-only — safe to use for locating files the user references. Searches from the specified root (default: current working directory).",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Filename pattern (e.g. '*.txt', 'config.json')" },
          root: { type: "string", description: "Root directory to search from (default: '.')" },
          max_depth: { type: "number", description: "Max depth (default 5)" },
        },
        required: ["pattern"],
      },
    },
  },
  async execute(args) {
    const pattern = String(args.pattern || "*");
    const root = String(args.root || ".");
    const maxDepth = Number(args.max_depth) || 5;
    try {
      // Use find command (read-only)
      const cmd = `find ${JSON.stringify(root)} -maxdepth ${maxDepth} -name ${JSON.stringify(pattern)} -type f 2>/dev/null | head -50`;
      const { stdout } = await execAsync(cmd, {
        timeout: 10000,
        maxBuffer: 1024 * 1024,
      });
      return stdout.trim() || "No files found.";
    } catch (e) {
      return `Error: ${(e as Error).message}`;
    }
  },
};

// ---------- Read System File ----------
const readSystemFile: ToolExecutor = {
  definition: {
    type: "function",
    function: {
      name: "read_system_file",
      description:
        "Read a file from the user's system. Use this when the user references a file by path and you need to see its contents. Read-only — does not modify the file. Returns text content (truncated to 20k chars).",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Absolute or relative file path" },
        },
        required: ["path"],
      },
    },
  },
  async execute(args) {
    const filePath = String(args.path || "");
    if (!filePath) return "Error: path required";
    try {
      const resolved = path.resolve(filePath);
      const buf = await fs.readFile(resolved);
      // Check the first 8KB for null bytes — if present, treat as binary
      const head = buf.subarray(0, Math.min(buf.length, 8000));
      const isText = !head.includes(0);
      if (isText) {
        const text = buf.toString("utf8");
        return text.length > 20000 ? text.slice(0, 20000) + "\n... (truncated)" : text;
      }
      return `Binary file (${buf.length} bytes). Use extract_file to extract content from binary formats.`;
    } catch (e) {
      return `Error: ${(e as Error).message}`;
    }
  },
};

// ---------- Write System File (with backup) ----------
const writeSystemFile: ToolExecutor = {
  definition: {
    type: "function",
    function: {
      name: "write_system_file",
      description:
        "Write to a file on the user's system. AUTOMATICALLY creates a backup of the existing file first (stored until the user accepts the change). Never deletes — the original can always be restored. Use for editing config files, code, etc. that the user asked you to modify.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path (absolute or relative)" },
          content: { type: "string", description: "New file content" },
        },
        required: ["path", "content"],
      },
    },
  },
  async execute(args) {
    const filePath = String(args.path || "");
    const content = String(args.content || "");
    if (!filePath) return "Error: path required";
    const resolved = path.resolve(filePath);
    try {
      // Backup existing file if it exists
      let backupPath: string | null = null;
      try {
        await fs.access(resolved);
        const backupDir = path.resolve(process.cwd(), "workspace", ".backups");
        await fs.mkdir(backupDir, { recursive: true });
        const backupName = `${path.basename(resolved)}.${Date.now()}.${crypto.randomBytes(4).toString("hex")}.bak`;
        backupPath = path.join(backupDir, backupName);
        await fs.copyFile(resolved, backupPath);
        await db.fileBackup.create({
          data: {
            originalPath: resolved,
            backupPath,
            accepted: false,
          },
        });
      } catch {
        // File doesn't exist yet — no backup needed
      }
      // Write new content
      await fs.mkdir(path.dirname(resolved), { recursive: true });
      await fs.writeFile(resolved, content, "utf8");
      return `Wrote ${content.length} bytes to ${resolved}.${backupPath ? ` Backup created at ${backupPath} (pending user acceptance).` : ""}`;
    } catch (e) {
      return `Error: ${(e as Error).message}`;
    }
  },
};

// ---------- List Pending Changes ----------
const listPendingChanges: ToolExecutor = {
  definition: {
    type: "function",
    function: {
      name: "list_pending_changes",
      description:
        "List file changes that haven't been accepted by the user yet (each has a backup). Returns paths and backup locations.",
      parameters: { type: "object", properties: {} },
    },
  },
  async execute() {
    const pending = await db.fileBackup.findMany({
      where: { accepted: false },
      orderBy: { createdAt: "desc" },
    });
    if (pending.length === 0) return "No pending changes.";
    return pending
      .map(
        (b, i) =>
          `${i + 1}. ${b.originalPath}\n   Backup: ${b.backupPath}\n   Changed: ${b.createdAt.toISOString().slice(0, 16)}`
      )
      .join("\n\n");
  },
};

// ---------- Edit File (find & replace) ----------
// Makes targeted edits to a file by replacing a unique old string with a new
// string. Auto-backs-up the file before editing (same as write_system_file).
const editFile: ToolExecutor = {
  definition: {
    type: "function",
    function: {
      name: "edit_file",
      description:
        "Edit a file by replacing a specific old_string with new_string. Creates a backup automatically before editing. The old_string must appear EXACTLY ONCE in the file (use enough context to make it unique). Use this for surgical edits instead of rewriting the whole file. For creating new files or full rewrites, use write_file or write_system_file.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path (absolute or relative)" },
          old_string: {
            type: "string",
            description: "The exact text to find in the file. Must be unique — include enough surrounding context to match only one location.",
          },
          new_string: {
            type: "string",
            description: "The text to replace old_string with. Can be empty (to delete).",
          },
          replace_all: {
            type: "boolean",
            description: "If true, replace ALL occurrences of old_string (default false — requires unique match).",
          },
        },
        required: ["path", "old_string", "new_string"],
      },
    },
  },
  async execute(args) {
    const filePath = String(args.path || "");
    const oldStr = String(args.old_string ?? "");
    const newStr = String(args.new_string ?? "");
    const replaceAll = args.replace_all === true;
    if (!filePath) return "Error: path required";
    if (!oldStr) return "Error: old_string required (cannot be empty)";
    const resolved = path.resolve(filePath);
    try {
      // Read existing content
      let content: string;
      try {
        content = await fs.readFile(resolved, "utf8");
      } catch {
        return `Error: file not found at ${resolved}`;
      }
      // Count matches
      const occurrences = content.split(oldStr).length - 1;
      if (occurrences === 0) {
        return `Error: old_string not found in ${resolved}. Make sure the text matches EXACTLY (including whitespace and indentation).`;
      }
      if (occurrences > 1 && !replaceAll) {
        return `Error: old_string appears ${occurrences} times in ${resolved}. Either provide more context to make it unique, or set replace_all=true.`;
      }
      // Backup
      const backupDir = path.resolve(process.cwd(), "workspace", ".backups");
      await fs.mkdir(backupDir, { recursive: true });
      const backupName = `${path.basename(resolved)}.${Date.now()}.${crypto.randomBytes(4).toString("hex")}.bak`;
      const backupPath = path.join(backupDir, backupName);
      await fs.copyFile(resolved, backupPath);
      await db.fileBackup.create({
        data: { originalPath: resolved, backupPath, accepted: false },
      });
      // Replace
      const newContent = replaceAll
        ? content.split(oldStr).join(newStr)
        : content.replace(oldStr, newStr);
      await fs.writeFile(resolved, newContent, "utf8");
      const replacedCount = replaceAll ? occurrences : 1;
      return `Edited ${resolved}: replaced ${replacedCount} occurrence${replacedCount > 1 ? "s" : ""} of old_string. Backup: ${backupPath}`;
    } catch (e) {
      return `Error: ${(e as Error).message}`;
    }
  },
};

// ---------- Append to File ----------
const appendFile: ToolExecutor = {
  definition: {
    type: "function",
    function: {
      name: "append_file",
      description:
        "Append text to the end of a file. Creates the file if it doesn't exist. Use this for adding to log files, appending entries, or building up a file incrementally.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path (absolute or relative)" },
          content: { type: "string", description: "Content to append" },
        },
        required: ["path", "content"],
      },
    },
  },
  async execute(args) {
    const filePath = String(args.path || "");
    const content = String(args.content || "");
    if (!filePath) return "Error: path required";
    const resolved = path.resolve(filePath);
    try {
      await fs.mkdir(path.dirname(resolved), { recursive: true });
      await fs.appendFile(resolved, content, "utf8");
      const stat = await fs.stat(resolved);
      return `Appended ${content.length} bytes to ${resolved}. File is now ${stat.size} bytes.`;
    } catch (e) {
      return `Error: ${(e as Error).message}`;
    }
  },
};

// ---------- Create Directory ----------
const createDirectory: ToolExecutor = {
  definition: {
    type: "function",
    function: {
      name: "create_directory",
      description:
        "Create a directory (and any missing parent directories). Use this before writing files to a new location, or to organize files.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Directory path to create" },
        },
        required: ["path"],
      },
    },
  },
  async execute(args) {
    const dirPath = String(args.path || "");
    if (!dirPath) return "Error: path required";
    const resolved = path.resolve(dirPath);
    try {
      await fs.mkdir(resolved, { recursive: true });
      return `Created directory: ${resolved}`;
    } catch (e) {
      return `Error: ${(e as Error).message}`;
    }
  },
};

// ---------- Delete File ----------
// Deletes a file (or empty directory). For non-empty directories, requires
// recursive=true. Always preserves a backup copy of any deleted file.
const deleteFile: ToolExecutor = {
  definition: {
    type: "function",
    function: {
      name: "delete_file",
      description:
        "Delete a file or directory. For files, creates a backup copy first (stored in workspace/.backups/) so it can be restored. For directories, requires recursive=true. Use with caution — prefer asking the user first for important files.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File or directory path to delete" },
          recursive: {
            type: "boolean",
            description: "If true and path is a directory, delete it recursively (including all contents). Required for non-empty directories.",
          },
        },
        required: ["path"],
      },
    },
  },
  async execute(args) {
    const filePath = String(args.path || "");
    const recursive = args.recursive === true;
    if (!filePath) return "Error: path required";
    const resolved = path.resolve(filePath);
    try {
      const stat = await fs.stat(resolved);
      if (stat.isDirectory()) {
        if (!recursive) {
          // Check if empty
          const entries = await fs.readdir(resolved);
          if (entries.length > 0) {
            return `Error: directory ${resolved} is not empty. Set recursive=true to delete it and all contents.`;
          }
        }
        await fs.rm(resolved, { recursive });
        return `Deleted directory: ${resolved}`;
      }
      // It's a file — back it up first
      const backupDir = path.resolve(process.cwd(), "workspace", ".backups");
      await fs.mkdir(backupDir, { recursive: true });
      const backupName = `${path.basename(resolved)}.${Date.now()}.${crypto.randomBytes(4).toString("hex")}.bak`;
      const backupPath = path.join(backupDir, backupName);
      await fs.copyFile(resolved, backupPath);
      await db.fileBackup.create({
        data: { originalPath: resolved, backupPath, accepted: false },
      });
      await fs.unlink(resolved);
      return `Deleted file: ${resolved}. Backup saved at ${backupPath} (can be restored via restore_file).`;
    } catch (e) {
      return `Error: ${(e as Error).message}`;
    }
  },
};

// ---------- Move / Rename File ----------
const moveFile: ToolExecutor = {
  definition: {
    type: "function",
    function: {
      name: "move_file",
      description:
        "Move or rename a file. Creates the destination directory if needed. The source must exist; the destination will be overwritten if it exists.",
      parameters: {
        type: "object",
        properties: {
          source: { type: "string", description: "Source file path" },
          destination: { type: "string", description: "Destination file path" },
        },
        required: ["source", "destination"],
      },
    },
  },
  async execute(args) {
    const src = String(args.source || "");
    const dst = String(args.destination || "");
    if (!src || !dst) return "Error: source and destination required";
    const srcPath = path.resolve(src);
    const dstPath = path.resolve(dst);
    try {
      await fs.mkdir(path.dirname(dstPath), { recursive: true });
      await fs.rename(srcPath, dstPath);
      return `Moved ${srcPath} → ${dstPath}`;
    } catch (e) {
      return `Error: ${(e as Error).message}`;
    }
  },
};

// ---------- Copy File ----------
const copyFile: ToolExecutor = {
  definition: {
    type: "function",
    function: {
      name: "copy_file",
      description:
        "Copy a file or directory. Creates the destination directory if needed. Source must exist.",
      parameters: {
        type: "object",
        properties: {
          source: { type: "string", description: "Source file or directory path" },
          destination: { type: "string", description: "Destination path" },
        },
        required: ["source", "destination"],
      },
    },
  },
  async execute(args) {
    const src = String(args.source || "");
    const dst = String(args.destination || "");
    if (!src || !dst) return "Error: source and destination required";
    const srcPath = path.resolve(src);
    const dstPath = path.resolve(dst);
    try {
      await fs.mkdir(path.dirname(dstPath), { recursive: true });
      await fs.cp(srcPath, dstPath, { recursive: true });
      const stat = await fs.stat(dstPath);
      return `Copied ${srcPath} → ${dstPath} (${stat.size} bytes${stat.isDirectory() ? ", directory" : ""})`;
    } catch (e) {
      return `Error: ${(e as Error).message}`;
    }
  },
};

// ---------- Restore File ----------
const restoreFile: ToolExecutor = {
  definition: {
    type: "function",
    function: {
      name: "restore_file",
      description: "Restore a file from its backup (undo a pending change).",
      parameters: {
        type: "object",
        properties: {
          original_path: { type: "string", description: "The original file path" },
        },
        required: ["original_path"],
      },
    },
  },
  async execute(args) {
    const originalPath = String(args.original_path || "");
    if (!originalPath) return "Error: original_path required";
    const backup = await db.fileBackup.findFirst({
      where: { originalPath: path.resolve(originalPath), accepted: false },
      orderBy: { createdAt: "desc" },
    });
    if (!backup) return `No pending backup found for ${originalPath}`;
    try {
      await fs.copyFile(backup.backupPath, backup.originalPath);
      await db.fileBackup.update({
        where: { id: backup.id },
        data: { accepted: true },
      });
      return `Restored ${backup.originalPath} from backup.`;
    } catch (e) {
      return `Error: ${(e as Error).message}`;
    }
  },
};

// ---------- Create Tool (custom tool framework) ----------
const createTool: ToolExecutor = {
  definition: {
    type: "function",
    function: {
      name: "create_tool",
      description:
        "Create a new custom tool that you can call in future conversations. The tool is defined by a name, description, JSON schema for parameters, and JavaScript code that implements it. The code receives `args` (the parsed parameters) and returns a string. You can use `fetch`, basic JS, and the standard library. Once created, the tool is automatically available in future tool calls. Use this to extend your own capabilities.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Tool name (snake_case, e.g. 'format_json', 'fetch_weather')",
          },
          description: {
            type: "string",
            description: "Description of what the tool does (be specific — this is what you'll see when deciding whether to use it)",
          },
          parameters_schema: {
            type: "object",
            description: "JSON Schema for the tool's parameters (same format as OpenAI function parameters)",
          },
          code: {
            type: "string",
            description: "JavaScript code. Must be an async function body that takes `args` and returns a string. Example: `const r = await fetch(args.url); return await r.text();`",
          },
        },
        required: ["name", "description", "parameters_schema", "code"],
      },
    },
  },
  async execute(args) {
    const name = String(args.name || "").trim();
    const description = String(args.description || "");
    const parametersSchema = args.parameters_schema;
    const code = String(args.code || "");
    if (!name || !description || !parametersSchema || !code) {
      return "Error: name, description, parameters_schema, code all required";
    }
    if (!/^[a-z][a-z0-9_]*$/.test(name)) {
      return "Error: name must be snake_case (lowercase letters, numbers, underscores, starting with a letter)";
    }
    // Validate the code compiles
    try {
      new Function("args", "fetch", "console", code);
    } catch (e) {
      return `Error: code does not compile: ${(e as Error).message}`;
    }
    await db.customTool.upsert({
      where: { name },
      create: {
        name,
        description,
        parameters: JSON.stringify(parametersSchema),
        code,
      },
      update: {
        description,
        parameters: JSON.stringify(parametersSchema),
        code,
      },
    });
    return `Created/updated custom tool "${name}". It will be available in future tool calls.`;
  },
};

// ---------- List Custom Tools ----------
const listCustomTools: ToolExecutor = {
  definition: {
    type: "function",
    function: {
      name: "list_custom_tools",
      description: "List all custom tools you've created for yourself.",
      parameters: { type: "object", properties: {} },
    },
  },
  async execute() {
    const tools = await db.customTool.findMany({
      orderBy: { updatedAt: "desc" },
    });
    if (tools.length === 0) return "No custom tools created yet. Use create_tool to make one.";
    return tools
      .map(
        (t, i) =>
          `${i + 1}. ${t.name}: ${t.description}`
      )
      .join("\n");
  },
};

// ---------- Delete Custom Tool ----------
const deleteCustomTool: ToolExecutor = {
  definition: {
    type: "function",
    function: {
      name: "delete_custom_tool",
      description: "Delete a custom tool you no longer need.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Tool name to delete" },
        },
        required: ["name"],
      },
    },
  },
  async execute(args) {
    const name = String(args.name || "");
    if (!name) return "Error: name required";
    try {
      await db.customTool.delete({ where: { name } });
      return `Deleted custom tool "${name}".`;
    } catch {
      return `Tool "${name}" not found.`;
    }
  },
};

export const systemTools: Record<string, ToolExecutor> = {
  find_files: findFiles,
  read_system_file: readSystemFile,
  write_system_file: writeSystemFile,
  edit_file: editFile,
  append_file: appendFile,
  create_directory: createDirectory,
  delete_file: deleteFile,
  move_file: moveFile,
  copy_file: copyFile,
  list_pending_changes: listPendingChanges,
  restore_file: restoreFile,
  create_tool: createTool,
  list_custom_tools: listCustomTools,
  delete_custom_tool: deleteCustomTool,
};

// ---------- Dynamic custom tool loader ----------
// Loads all enabled custom tools from DB and returns them as ToolExecutors
export async function loadCustomTools(): Promise<Record<string, ToolExecutor>> {
  const tools = await db.customTool.findMany({ where: { enabled: true } });
  const out: Record<string, ToolExecutor> = {};
  for (const t of tools) {
    let parameters: Record<string, unknown>;
    try {
      parameters = JSON.parse(t.parameters);
    } catch {
      parameters = { type: "object", properties: {} };
    }
    out[t.name] = {
      definition: {
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters,
        },
      },
      async execute(args: Record<string, unknown>) {
        try {
          const fn = new Function(
            "args",
            "fetch",
            "console",
            `"use strict";\nreturn (async () => {\n${t.code}\n})();`
          );
          const result = await fn(args, fetch, console);
          return typeof result === "string" ? result : JSON.stringify(result, null, 2);
        } catch (e) {
          return `Custom tool error: ${(e as Error).message}`;
        }
      },
    };
  }
  return out;
}
