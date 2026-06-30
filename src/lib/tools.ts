// src/lib/tools.ts
// Tool registry — defines all tools the agent can call.
// Each tool: name, description, JSON schema, executor.

import type { ToolDefinition } from "./types";
import path from "node:path";
import fs from "node:fs/promises";
import vm from "node:vm";
import { memoryTools } from "./tools-memory";
import { envTools } from "./tools-env";
import { systemTools, loadCustomTools } from "./tools-system";
import { fileTools } from "./tools-files";
import { imageTools } from "./tools-image";
import { streamTools } from "./tools-stream";
import { searchTools } from "./tools-search";
import { embedTools } from "./tools-embed";
import {
  searchDuckDuckGoWeb,
  searchWikipedia,
  fetchWikipediaExtract,
  htmlToReadableText,
  fetchWithUA,
} from "./search-utils";

export interface ToolExecutor {
  definition: ToolDefinition;
  execute: (
    args: Record<string, unknown>,
    ctx: ToolContext
  ) => Promise<string>;
}

export interface ToolContext {
  conversationId: string;
  signal?: AbortSignal;
  // Tool-scoped scratch dir for file ops
  workDir: string;
}

// ---------- Web Search ----------
// Tries multiple sources in parallel for robustness:
//   1. Wikipedia  — best for factual / encyclopedic queries
//   2. DuckDuckGo — broad web results
// Wikipedia results come first (higher quality snippets), then DDG.
const webSearch: ToolExecutor = {
  definition: {
    type: "function",
    function: {
      name: "web_search",
      description:
        "Search the web for up-to-date information. Returns titles, URLs, and snippets from multiple sources (Wikipedia + DuckDuckGo). Use this when you need current info, facts, or to look up anything beyond your training data. For deeper info on a topic, follow up with web_fetch on a promising URL.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query",
          },
          max_results: {
            type: "number",
            description: "Maximum number of results to return per source (default 4)",
          },
          include_wikipedia: {
            type: "boolean",
            description: "Whether to include Wikipedia results (default true). Set false for purely news/web queries.",
          },
        },
        required: ["query"],
      },
    },
  },
  async execute(args) {
    const query = String(args.query || "").trim();
    const maxPerSource = Math.min(Number(args.max_results) || 4, 8);
    const includeWiki = args.include_wikipedia !== false;
    if (!query) return "Error: query is required";

    // Fire both searches in parallel for speed
    const [wikiRes, ddgRes] = await Promise.all([
      includeWiki ? searchWikipedia(query, 3) : Promise.resolve([]),
      searchDuckDuckGoWeb(query, maxPerSource),
    ]);

    const lines: string[] = [];
    let i = 1;

    if (wikiRes.length > 0) {
      lines.push("=== Wikipedia ===");
      for (const r of wikiRes) {
        lines.push(`${i}. ${r.title}`);
        lines.push(`   URL: ${r.url}`);
        if (r.snippet) lines.push(`   ${r.snippet}`);
        lines.push("");
        i++;
      }
    }

    if (ddgRes.length > 0) {
      lines.push("=== Web ===");
      for (const r of ddgRes) {
        lines.push(`${i}. ${r.title}`);
        lines.push(`   URL: ${r.url}`);
        if (r.snippet) lines.push(`   ${r.snippet}`);
        lines.push("");
        i++;
      }
    }

    if (lines.length === 0) {
      return `No results found for: ${query}`;
    }
    return lines.join("\n").trim();
  },
};

// ---------- Web Fetch ----------
// Smarter page reader:
//   • Auto-detects content type (HTML / JSON / plain text / PDF)
//   • For HTML, extracts main content (readability heuristic) instead of all text
//   • For Wikipedia URLs, uses the API to get a clean extract (no nav noise)
//   • For JSON APIs, pretty-prints the response
//   • For PDFs, downloads and runs pdftotext
const webFetch: ToolExecutor = {
  definition: {
    type: "function",
    function: {
      name: "web_fetch",
      description:
        "Fetch the content of a web page URL and return readable text. Handles HTML (extracts main article content, strips nav/ads), JSON (pretty-prints), plain text, and PDFs (extracts text via pdftotext). For Wikipedia URLs, uses the API for a clean extract. Useful for reading articles, documentation, or any accessible web page.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "The URL to fetch" },
          max_chars: {
            type: "number",
            description: "Maximum characters to return (default 12000)",
          },
        },
        required: ["url"],
      },
    },
  },
  async execute(args) {
    const url = String(args.url || "").trim();
    const maxChars = Number(args.max_chars) || 12000;
    if (!url) return "Error: url is required";

    // --- Special case: Wikipedia article → use API for clean extract ---
    const wikiMatch = url.match(/^https?:\/\/en\.wikipedia\.org\/wiki\/(.+)$/);
    if (wikiMatch) {
      const title = decodeURIComponent(wikiMatch[1].replace(/_/g, " ").replace(/#.*/, ""));
      const extract = await fetchWikipediaExtract(title);
      if (extract) return extract.slice(0, maxChars);
    }

    try {
      const resp = await fetchWithUA(url, { redirect: "follow" }, { timeoutMs: 20000 });
      if (!resp.ok) return `Fetch failed: ${resp.status} ${resp.statusText}`;
      const ct = (resp.headers.get("content-type") || "").toLowerCase();

      // --- PDF: extract text via pdftotext ---
      if (ct.includes("application/pdf") || url.toLowerCase().endsWith(".pdf")) {
        try {
          const buf = Buffer.from(await resp.arrayBuffer());
          const { exec } = await import("node:child_process");
          const { promisify } = await import("node:util");
          const execAsync = promisify(exec);
          const tmpPath = path.join(process.cwd(), "workspace", ".cache", `fetch-${Date.now()}.pdf`);
          await fs.mkdir(path.dirname(tmpPath), { recursive: true });
          await fs.writeFile(tmpPath, buf);
          const { stdout } = await execAsync(`pdftotext -layout ${JSON.stringify(tmpPath)} -`, {
            maxBuffer: 10 * 1024 * 1024,
            timeout: 30000,
          });
          await fs.unlink(tmpPath).catch(() => {});
          const text = stdout || "(no text extracted from PDF)";
          return text.slice(0, maxChars);
        } catch (e) {
          return `PDF extraction failed: ${(e as Error).message}`;
        }
      }

      // --- JSON: pretty-print ---
      if (ct.includes("application/json") || url.toLowerCase().endsWith(".json")) {
        try {
          const data = await resp.json();
          return JSON.stringify(data, null, 2).slice(0, maxChars);
        } catch {
          // fall through to text
        }
      }

      const raw = await resp.text();

      // --- HTML: extract main content ---
      if (ct.includes("text/html") || ct.includes("application/xhtml")) {
        const text = htmlToReadableText(raw, maxChars);
        return text || "(empty page)";
      }

      // --- Plain text / unknown: return as-is ---
      return raw.slice(0, maxChars);
    } catch (e) {
      return `Fetch error: ${(e as Error).message}`;
    }
  },
};

// ---------- Code Execution (sandboxed via Node vm) ----------
const codeExec: ToolExecutor = {
  definition: {
    type: "function",
    function: {
      name: "execute_code",
      description:
        "Execute JavaScript/TypeScript code in a sandboxed Node environment. Useful for calculations, data processing, and quick scripts. The code runs in a fresh VM context with no file system access. Print results via console.log().",
      parameters: {
        type: "object",
        properties: {
          code: {
            type: "string",
            description: "The JavaScript code to execute",
          },
          language: {
            type: "string",
            description: "Programming language (only 'javascript' supported)",
          },
        },
        required: ["code"],
      },
    },
  },
  async execute(args) {
    const code = String(args.code || "");
    if (!code) return "Error: code is required";
    // Use Node's vm module for sandboxed execution
    const logs: string[] = [];
    const sandbox = {
      console: {
        log: (...a: unknown[]) =>
          logs.push(a.map(stringifySafe).join(" ")),
        error: (...a: unknown[]) =>
          logs.push("[ERR] " + a.map(stringifySafe).join(" ")),
        warn: (...a: unknown[]) =>
          logs.push("[WARN] " + a.map(stringifySafe).join(" ")),
        info: (...a: unknown[]) =>
          logs.push(a.map(stringifySafe).join(" ")),
      },
      Math,
      JSON,
      Date,
      parseInt,
      parseFloat,
      isNaN,
      String,
      Number,
      Boolean,
      Array,
      Object,
      RegExp,
      Error,
      Symbol,
      Promise,
      setTimeout: () => {},
      clearTimeout: () => {},
    };
    try {
      const context = vm.createContext(sandbox);
      const script = new vm.Script(code, { timeout: 5000 });
      const result = script.runInContext(context, { timeout: 5000 });
      let out = logs.join("\n");
      if (result !== undefined) {
        out += (out ? "\n" : "") + "→ " + stringifySafe(result);
      }
      return out || "(no output)";
    } catch (e) {
      return `Execution error: ${(e as Error).message}`;
    }
  },
};

function stringifySafe(v: unknown): string {
  if (typeof v === "string") return v;
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

// ---------- List Files (project scratch dir) ----------
const listFiles: ToolExecutor = {
  definition: {
    type: "function",
    function: {
      name: "list_files",
      description:
        "List files in a directory. Useful for exploring the workspace or checking what files exist.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Directory path (relative to workspace root). Default '.'",
          },
        },
      },
    },
  },
  async execute(args, ctx) {
    const rel = String(args.path || ".");
    const target = path.resolve(ctx.workDir, rel);
    try {
      const entries = await fs.readdir(target, { withFileTypes: true });
      if (entries.length === 0) return "(empty directory)";
      return entries
        .map((e) =>
          e.isDirectory() ? `${e.name}/` : e.name
        )
        .sort()
        .join("\n");
    } catch (e) {
      return `Error: ${(e as Error).message}`;
    }
  },
};

// ---------- Read File ----------
const readFile: ToolExecutor = {
  definition: {
    type: "function",
    function: {
      name: "read_file",
      description: "Read the contents of a file from the workspace.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path (relative to workspace root)" },
        },
        required: ["path"],
      },
    },
  },
  async execute(args, ctx) {
    const rel = String(args.path || "");
    const target = path.resolve(ctx.workDir, rel);
    try {
      const buf = await fs.readFile(target);
      const text = buf.toString("utf8");
      return text.length > 20000 ? text.slice(0, 20000) + "\n... (truncated)" : text;
    } catch (e) {
      return `Error: ${(e as Error).message}`;
    }
  },
};

// ---------- Write File ----------
const writeFile: ToolExecutor = {
  definition: {
    type: "function",
    function: {
      name: "write_file",
      description: "Write content to a file in the workspace. Creates the file if it doesn't exist, overwrites if it does.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path (relative to workspace root)" },
          content: { type: "string", description: "Content to write" },
        },
        required: ["path", "content"],
      },
    },
  },
  async execute(args, ctx) {
    const rel = String(args.path || "");
    const content = String(args.content || "");
    const target = path.resolve(ctx.workDir, rel);
    try {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, content, "utf8");
      return `Wrote ${content.length} bytes to ${rel}`;
    } catch (e) {
      return `Error: ${(e as Error).message}`;
    }
  },
};

// ---------- Calculator ----------
const calculator: ToolExecutor = {
  definition: {
    type: "function",
    function: {
      name: "calculate",
      description:
        "Evaluate a mathematical expression safely. Supports +, -, *, /, **, parentheses, Math functions, etc. Returns the result.",
      parameters: {
        type: "object",
        properties: {
          expression: {
            type: "string",
            description: "Math expression, e.g. '2 + 3 * 4' or 'Math.sqrt(144)'",
          },
        },
        required: ["expression"],
      },
    },
  },
  async execute(args) {
    const expr = String(args.expression || "");
    if (!expr) return "Error: expression is required";
    try {
      const result = vm.runInNewContext(expr, { Math }, { timeout: 2000 });
      return `= ${stringifySafe(result)}`;
    } catch (e) {
      return `Calculation error: ${(e as Error).message}`;
    }
  },
};

// ---------- get_tools (definition only — handled specially in agent.ts) ----------
const getToolsDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "get_tools",
    description:
      "Request additional tools for the task you want to perform. You always have web_search available. For any other capability (code execution, math, file operations, memory, virtual environments, image generation, etc.), call this tool with a description of what you want to do, and the relevant tools will be added to your available set. You can then call those tools in subsequent steps.",
    parameters: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: "Describe the task you want to perform (e.g. 'calculate math', 'run code', 'read a file', 'generate an image', 'create a virtual environment', 'search memory'). You can also specify exact tool names.",
        },
      },
      required: ["task"],
    },
  },
};

// ---------- Registry ----------
// Merge built-in tools with all the new tool categories.
// streamTools is last so its generate_image overrides the one in imageTools
// (the stream version returns injectable markdown instead of instructions).
export const toolRegistry: Record<string, ToolExecutor> = {
  web_search: webSearch,
  web_fetch: webFetch,
  execute_code: codeExec,
  list_files: listFiles,
  read_file: readFile,
  write_file: writeFile,
  calculate: calculator,
  ...memoryTools,
  ...envTools,
  ...systemTools,
  ...fileTools,
  ...imageTools,
  ...searchTools,
  ...embedTools,
  ...streamTools,
};

// Cached custom tools (loaded fresh per request in loadAllTools)
let _customToolsCache: Record<string, ToolExecutor> = {};
let _customToolsCacheTime = 0;

export async function refreshCustomTools() {
  _customToolsCache = await loadCustomTools();
  _customToolsCacheTime = Date.now();
}

export function getAllToolExecutors(): Record<string, ToolExecutor> {
  return { ...toolRegistry, ..._customToolsCache };
}

export const allToolDefinitions: ToolDefinition[] = [
  getToolsDefinition,
  ...Object.values(toolRegistry).map((t) => t.definition),
];

export function getToolDefinitions(names?: string[]): ToolDefinition[] {
  if (!names || names.length === 0) {
    // Include get_tools + custom tools
    const all = [...allToolDefinitions];
    for (const t of Object.values(_customToolsCache)) {
      all.push(t.definition);
    }
    return all;
  }
  const all = getAllToolExecutors();
  const result = names
    .map((n) => all[n]?.definition)
    .filter(Boolean) as ToolDefinition[];
  // Always include get_tools definition
  if (!names.includes("get_tools")) {
    result.unshift(getToolsDefinition);
  }
  return result;
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<string> {
  const all = getAllToolExecutors();
  const tool = all[name];
  if (!tool) return `Unknown tool: ${name}`;
  try {
    return await tool.execute(args, ctx);
  } catch (e) {
    return `Tool error: ${(e as Error).message}`;
  }
}
