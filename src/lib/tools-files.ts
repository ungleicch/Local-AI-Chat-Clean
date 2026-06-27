// File extraction tool — extracts text from uploaded files (PDF, image, docx, etc.)
import type { ToolDefinition } from "./types";
import type { ToolExecutor } from "./tools";
import { db } from "./db";
import path from "node:path";
import fs from "node:fs/promises";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

// ---------- Extract File ----------
const extractFile: ToolExecutor = {
  definition: {
    type: "function",
    function: {
      name: "extract_file",
      description:
        "Extract text content from an uploaded file (PDF, image, text, code, etc.). For PDFs, uses pdftotext. For images, uses OCR (tesseract). For text files, returns content directly. Returns the extracted text. Use this when the user uploads a file and you need to read its contents.",
      parameters: {
        type: "object",
        properties: {
          file_id: {
            type: "string",
            description: "The uploaded file ID (from the attachments list in the user message)",
          },
        },
        required: ["file_id"],
      },
    },
  },
  async execute(args) {
    const fileId = String(args.file_id || "");
    if (!fileId) return "Error: file_id required";
    const file = await db.uploadedFile.findUnique({ where: { id: fileId } });
    if (!file) return `Error: file ${fileId} not found`;
    if (file.extracted && file.extractedText) {
      return `=== ${file.filename} (cached) ===\n\n${file.extractedText}`;
    }
    try {
      let text = "";
      const mime = file.mimeType;
      if (mime.startsWith("text/") || /\.(txt|md|json|js|ts|tsx|jsx|py|rb|go|rs|java|c|cpp|h|hpp|css|html|xml|yml|yaml|toml|ini|sh|bash|zsh)$/i.test(file.filename)) {
        text = await fs.readFile(file.storagePath, "utf8");
      } else if (mime === "application/pdf" || /\.pdf$/i.test(file.filename)) {
        try {
          const { stdout } = await execAsync(
            `pdftotext -layout ${JSON.stringify(file.storagePath)} -`,
            { maxBuffer: 10 * 1024 * 1024, timeout: 30000 }
          );
          text = stdout;
        } catch (e) {
          text = `(pdftotext failed: ${(e as Error).message})`;
        }
      } else if (mime.startsWith("image/")) {
        try {
          const { stdout } = await execAsync(
            `tesseract ${JSON.stringify(file.storagePath)} - 2>/dev/null`,
            { maxBuffer: 10 * 1024 * 1024, timeout: 60000 }
          );
          text = stdout.trim() || "(no text detected in image via OCR)";
        } catch (e) {
          text = `(OCR failed: ${(e as Error).message}. For image understanding, describe what you see to the user.)`;
        }
      } else if (/\.(docx|doc)$/i.test(file.filename)) {
        // Try docx2txt or pandoc
        try {
          const { stdout } = await execAsync(
            `pandoc -t plain ${JSON.stringify(file.storagePath)} 2>/dev/null`,
            { maxBuffer: 10 * 1024 * 1024, timeout: 30000 }
          );
          text = stdout;
        } catch {
          text = "(docx extraction requires pandoc — not available)";
        }
      } else if (/\.(xlsx|xls|csv)$/i.test(file.filename)) {
        // CSV is text, xlsx needs tooling
        if (file.filename.toLowerCase().endsWith(".csv")) {
          text = await fs.readFile(file.storagePath, "utf8");
        } else {
          text = "(xlsx extraction not available — convert to CSV first)";
        }
      } else {
        // Try as text fallback
        try {
          text = await fs.readFile(file.storagePath, "utf8");
        } catch {
          text = `(Could not extract text from ${file.filename} (${mime}))`;
        }
      }
      // Truncate very large extractions
      if (text.length > 50000) {
        text = text.slice(0, 50000) + "\n\n... (truncated, full length: " + text.length + " chars)";
      }
      // Cache
      await db.uploadedFile.update({
        where: { id: fileId },
        data: { extractedText: text, extracted: true },
      });
      return `=== ${file.filename} ===\n\n${text}`;
    } catch (e) {
      return `Extraction error: ${(e as Error).message}`;
    }
  },
};

// ---------- List Uploaded Files ----------
const listUploadedFiles: ToolExecutor = {
  definition: {
    type: "function",
    function: {
      name: "list_uploaded_files",
      description:
        "List files uploaded in the current conversation. Returns file IDs, names, and MIME types. Use extract_file with a file ID to read its contents.",
      parameters: { type: "object", properties: {} },
    },
  },
  async execute(_args, ctx) {
    // Find messages with attachments in this conversation
    const messages = await db.message.findMany({
      where: { conversationId: ctx.conversationId, attachments: { not: null } },
    });
    const fileIds: string[] = [];
    for (const m of messages) {
      if (m.attachments) {
        try {
          const ids = JSON.parse(m.attachments);
          if (Array.isArray(ids)) fileIds.push(...ids);
        } catch {
          // ignore
        }
      }
    }
    if (fileIds.length === 0) return "No files uploaded in this conversation.";
    const files = await db.uploadedFile.findMany({
      where: { id: { in: fileIds } },
    });
    return files
      .map((f, i) => `${i + 1}. ${f.filename}\n   ID: ${f.id}\n   Type: ${f.mimeType}\n   Size: ${f.size} bytes`)
      .join("\n\n");
  },
};

export const fileTools: Record<string, ToolExecutor> = {
  extract_file: extractFile,
  list_uploaded_files: listUploadedFiles,
};
