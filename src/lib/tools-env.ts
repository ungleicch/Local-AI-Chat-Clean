// Virtual environment & safe system file tools
import type { ToolDefinition } from "./types";
import type { ToolExecutor, ToolContext } from "./tools";
import { db } from "./db";
import path from "node:path";
import fs from "node:fs/promises";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import crypto from "node:crypto";

const execAsync = promisify(exec);

// Whitelist of commands allowed in virtual environments
const SAFE_COMMANDS = new Set([
  "ls", "cat", "echo", "mkdir", "touch", "cp", "mv", "head", "tail", "wc",
  "grep", "find", "sort", "uniq", "diff", "tree", "pwd", "cd", "env",
  "node", "npm", "npx", "bun", "yarn", "pnpm", "python", "python3", "pip",
  "pip3", "ruby", "go", "rustc", "cargo", "gcc", "g++", "make", "cmake",
  "git", "curl", "wget", "tar", "zip", "unzip", "gzip", "gunzip",
  "sed", "awk", "tr", "cut", "paste", "column", "tee",
  "ssh-keygen", "openssl", "base64", "xxd",
  "tsc", "eslint", "prettier", "jest", "vitest", "pytest",
  "javac", "java", "dotnet",
]);

// Commands that must NEVER run (even with sudo prefix)
const FORBIDDEN_PATTERNS = [
  /\brm\s+-rf\s+\//,  // rm -rf /
  /\bsudo\b/,
  /\bmkfs\b/,
  /\bdd\s+if=.*of=\/dev\//,
  /:\(\)\s*\{.*\};:/,  // fork bomb
  /\bshutdown\b/,
  /\breboot\b/,
  /\bkillall\b/,
];

function validateCommand(cmd: string): { ok: boolean; error?: string; binary?: string } {
  const trimmed = cmd.trim();
  if (!trimmed) return { ok: false, error: "Empty command" };
  // Check forbidden patterns
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { ok: false, error: `Forbidden pattern in command` };
    }
  }
  // Extract binary name (first token, or after sudo/etc)
  const tokens = trimmed.split(/\s+/);
  let binary = tokens[0];
  // Handle paths like ./script or /usr/bin/foo
  if (binary.includes("/")) {
    binary = path.basename(binary);
  }
  if (!SAFE_COMMANDS.has(binary)) {
    return { ok: false, error: `Command "${binary}" not in whitelist. Allowed: ${Array.from(SAFE_COMMANDS).slice(0, 20).join(", ")}…` };
  }
  return { ok: true, binary };
}

// ---------- Create Virtual Env ----------
const createEnv: ToolExecutor = {
  definition: {
    type: "function",
    function: {
      name: "create_env",
      description:
        "Create a new isolated virtual environment (a sandboxed working directory). Use this when you need to build something, run code that has side effects, or test commands safely. Returns an env ID you can use with run_in_env. Always create an env before running build commands.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "A name for the env (e.g. 'project-build-1')" },
        },
        required: ["name"],
      },
    },
  },
  async execute(args) {
    const name = String(args.name || "").replace(/[^a-zA-Z0-9-_]/g, "-");
    if (!name) return "Error: name required";
    const id = `env-${crypto.randomUUID().slice(0, 8)}`;
    const envPath = path.resolve(process.cwd(), "workspace", "envs", id);
    await fs.mkdir(envPath, { recursive: true });
    // Write a small README in the env
    await fs.writeFile(
      path.join(envPath, ".env-info.json"),
      JSON.stringify({ id, name, createdAt: new Date().toISOString() }, null, 2)
    );
    await db.virtualEnv.create({
      data: { id, name, path: envPath, status: "active" },
    });
    return `Created virtual environment "${name}" (ID: ${id}) at ${envPath}. Use run_in_env with this env_id to execute commands inside it.`;
  },
};

// ---------- Run in Env ----------
const runInEnv: ToolExecutor = {
  definition: {
    type: "function",
    function: {
      name: "run_in_env",
      description:
        "Run a shell command inside a virtual environment. The command runs with cwd set to the env's directory. Only whitelisted commands are allowed (ls, cat, node, npm, bun, python, git, make, gcc, etc.). Use this for any command that builds, compiles, or has side effects. Output is captured and returned.",
      parameters: {
        type: "object",
        properties: {
          env_id: { type: "string", description: "Virtual environment ID from create_env" },
          command: { type: "string", description: "Shell command to run" },
          timeout: { type: "number", description: "Timeout in seconds (default 30, max 120)" },
        },
        required: ["env_id", "command"],
      },
    },
  },
  async execute(args, ctx) {
    const envId = String(args.env_id || "");
    const command = String(args.command || "");
    const timeoutSec = Math.min(Number(args.timeout) || 30, 120);
    if (!envId || !command) return "Error: env_id and command required";
    const env = await db.virtualEnv.findUnique({ where: { id: envId } });
    if (!env) return `Error: env ${envId} not found`;
    if (env.status !== "active") return `Error: env ${envId} is ${env.status}`;

    const validation = validateCommand(command);
    if (!validation.ok) {
      return `Error: ${validation.error}`;
    }

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: env.path,
        timeout: timeoutSec * 1000,
        maxBuffer: 1024 * 1024,
        env: { ...process.env, PATH: process.env.PATH },
      });
      let out = "";
      if (stdout) out += stdout;
      if (stderr) out += (out ? "\n" : "") + "[stderr]\n" + stderr;
      return out || "(no output)";
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string; message: string };
      let out = "";
      if (err.stdout) out += err.stdout;
      if (err.stderr) out += (out ? "\n" : "") + "[stderr]\n" + err.stderr;
      if (err.message?.includes("ETIMEDOUT")) {
        out += (out ? "\n" : "") + "[Command timed out]";
      }
      return out || `Error: ${err.message}`;
    }
  },
};

// ---------- Copy From Env ----------
const copyFromEnv: ToolExecutor = {
  definition: {
    type: "function",
    function: {
      name: "copy_from_env",
      description:
        "Copy a file or directory from a virtual environment to the user's workspace (the main system workspace). Use this after building something in an env to extract the final artifact. Source is relative to env root; destination is relative to workspace root.",
      parameters: {
        type: "object",
        properties: {
          env_id: { type: "string", description: "Virtual environment ID" },
          source: { type: "string", description: "Path inside the env (relative)" },
          destination: { type: "string", description: "Destination path in workspace (relative)" },
        },
        required: ["env_id", "source", "destination"],
      },
    },
  },
  async execute(args, ctx) {
    const envId = String(args.env_id || "");
    const source = String(args.source || "");
    const destination = String(args.destination || "");
    if (!envId || !source || !destination) return "Error: env_id, source, destination required";
    const env = await db.virtualEnv.findUnique({ where: { id: envId } });
    if (!env) return `Error: env ${envId} not found`;
    const srcPath = path.resolve(env.path, source);
    const dstPath = path.resolve(ctx.workDir, destination);
    // Ensure dst is inside workDir
    if (!dstPath.startsWith(ctx.workDir)) {
      return "Error: destination must be inside workspace";
    }
    try {
      await fs.mkdir(path.dirname(dstPath), { recursive: true });
      await fs.cp(srcPath, dstPath, { recursive: true });
      const stat = await fs.stat(dstPath);
      return `Copied ${source} → ${destination} (${stat.size} bytes${stat.isDirectory() ? ", directory" : ""})`;
    } catch (e) {
      return `Error: ${(e as Error).message}`;
    }
  },
};

// ---------- Kill Env ----------
const killEnv: ToolExecutor = {
  definition: {
    type: "function",
    function: {
      name: "kill_env",
      description:
        "Destroy a virtual environment — deletes its directory and marks it killed. Use this when you're done with an env to free up space. Cannot be undone.",
      parameters: {
        type: "object",
        properties: {
          env_id: { type: "string", description: "Virtual environment ID" },
        },
        required: ["env_id"],
      },
    },
  },
  async execute(args) {
    const envId = String(args.env_id || "");
    if (!envId) return "Error: env_id required";
    const env = await db.virtualEnv.findUnique({ where: { id: envId } });
    if (!env) return `Error: env ${envId} not found`;
    try {
      await fs.rm(env.path, { recursive: true, force: true });
    } catch {
      // ignore
    }
    await db.virtualEnv.update({
      where: { id: envId },
      data: { status: "killed" },
    });
    return `Killed env ${envId} (${env.name}). Directory removed.`;
  },
};

// ---------- List Envs ----------
const listEnvs: ToolExecutor = {
  definition: {
    type: "function",
    function: {
      name: "list_envs",
      description: "List all virtual environments and their status (active/killed).",
      parameters: { type: "object", properties: {} },
    },
  },
  async execute() {
    const envs = await db.virtualEnv.findMany({
      orderBy: { createdAt: "desc" },
    });
    if (envs.length === 0) return "No virtual environments. Use create_env to make one.";
    return envs
      .map(
        (e, i) =>
          `${i + 1}. [${e.status}] ${e.name} (ID: ${e.id})\n   Path: ${e.path}\n   Created: ${e.createdAt.toISOString().slice(0, 16)}`
      )
      .join("\n\n");
  },
};

// ---------- Write File to Env ----------
const writeEnvFile: ToolExecutor = {
  definition: {
    type: "function",
    function: {
      name: "write_env_file",
      description:
        "Write a file inside a virtual environment. Useful for setting up code before running build commands.",
      parameters: {
        type: "object",
        properties: {
          env_id: { type: "string", description: "Virtual environment ID" },
          path: { type: "string", description: "File path inside the env (relative)" },
          content: { type: "string", description: "File content" },
        },
        required: ["env_id", "path", "content"],
      },
    },
  },
  async execute(args) {
    const envId = String(args.env_id || "");
    const filePath = String(args.path || "");
    const content = String(args.content || "");
    if (!envId || !filePath) return "Error: env_id and path required";
    const env = await db.virtualEnv.findUnique({ where: { id: envId } });
    if (!env) return `Error: env ${envId} not found`;
    const target = path.resolve(env.path, filePath);
    if (!target.startsWith(env.path)) return "Error: path must be inside env";
    try {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, content, "utf8");
      return `Wrote ${content.length} bytes to ${filePath} in env ${envId}`;
    } catch (e) {
      return `Error: ${(e as Error).message}`;
    }
  },
};

// ---------- Read File from Env ----------
const readEnvFile: ToolExecutor = {
  definition: {
    type: "function",
    function: {
      name: "read_env_file",
      description: "Read a file from inside a virtual environment.",
      parameters: {
        type: "object",
        properties: {
          env_id: { type: "string", description: "Virtual environment ID" },
          path: { type: "string", description: "File path inside the env (relative)" },
        },
        required: ["env_id", "path"],
      },
    },
  },
  async execute(args) {
    const envId = String(args.env_id || "");
    const filePath = String(args.path || "");
    if (!envId || !filePath) return "Error: env_id and path required";
    const env = await db.virtualEnv.findUnique({ where: { id: envId } });
    if (!env) return `Error: env ${envId} not found`;
    const target = path.resolve(env.path, filePath);
    if (!target.startsWith(env.path)) return "Error: path must be inside env";
    try {
      const buf = await fs.readFile(target);
      const text = buf.toString("utf8");
      return text.length > 20000 ? text.slice(0, 20000) + "\n... (truncated)" : text;
    } catch (e) {
      return `Error: ${(e as Error).message}`;
    }
  },
};

export const envTools: Record<string, ToolExecutor> = {
  create_env: createEnv,
  run_in_env: runInEnv,
  copy_from_env: copyFromEnv,
  kill_env: killEnv,
  list_envs: listEnvs,
  write_env_file: writeEnvFile,
  read_env_file: readEnvFile,
};
