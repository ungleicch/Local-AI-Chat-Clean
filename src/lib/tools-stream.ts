// Stream-injectable tools — their markdown output is injected directly into
// the response stream as a text chunk, so tables/images appear instantly
// when the tool runs, without waiting for the model to re-generate them.
//
// The agent loop (agent.ts) detects these tools by name and, after executing
// them, yields the result content as BOTH:
//   1. A `text` chunk (so it appears in the stream immediately)
//   2. A `tool_result` chunk (so the thinking indicator shows it)
//
// The tool result content includes a note telling the model not to repeat
// the content, since it's already been injected.

import type { ToolDefinition } from "./types";
import type { ToolExecutor } from "./tools";
import { db } from "./db";
import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";

// ---------- create_table ----------
const createTable: ToolExecutor = {
  definition: {
    type: "function",
    function: {
      name: "create_table",
      description:
        "Create a formatted markdown table from structured data and inject it directly into your response. The table appears instantly in the chat — you do NOT need to write the markdown yourself. Use this whenever you want to present tabular data (comparisons, schedules, data sets, etc.). Just provide the column headers and the row data.",
      parameters: {
        type: "object",
        properties: {
          headers: {
            type: "array",
            items: { type: "string" },
            description: "Column header names, e.g. [\"Name\", \"Age\", \"City\"]",
          },
          rows: {
            type: "array",
            items: {
              type: "array",
              items: { type: "string" },
              description: "A row of cell values (one per column)",
            },
            description: "Array of rows, each row is an array of cell values. e.g. [[\"Alice\", \"30\", \"NYC\"], [\"Bob\", \"25\", \"LA\"]]",
          },
          title: {
            type: "string",
            description: "Optional table title/caption shown above the table",
          },
        },
        required: ["headers", "rows"],
      },
    },
  },
  async execute(args) {
    const headers = args.headers as string[];
    const rows = (args.rows as string[][]) || [];
    const title = String(args.title || "");

    if (!Array.isArray(headers) || headers.length === 0) {
      return "Error: headers must be a non-empty array of strings";
    }

    // Build markdown table
    // Escape pipe characters and newlines in cell values
    const escapeCell = (val: unknown): string => {
      const s = val == null ? "" : String(val);
      return s.replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
    };

    const headerRow = `| ${headers.map(escapeCell).join(" | ")} |`;
    const separator = `| ${headers.map(() => "---").join(" | ")} |`;
    const dataRows = rows.map(
      (row) => `| ${headers.map((_, i) => escapeCell(row[i])).join(" | ")} |`
    );

    let table = headerRow + "\n" + separator;
    if (dataRows.length > 0) {
      table += "\n" + dataRows.join("\n");
    }

    // Prepend title if provided
    const markdown = title
      ? `**${title}**\n\n${table}`
      : table;

    return markdown;
  },
};

// ---------- embed_image ----------
// Embeds an existing image (by file ID or URL) into the response.
const embedImage: ToolExecutor = {
  definition: {
    type: "function",
    function: {
      name: "embed_image",
      description:
        "Embed an image into your response using its URL or a file ID from a previously uploaded/generated file. The image appears instantly in the chat. Use this to show images the user uploaded, images you generated earlier, or any public image URL.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "A public image URL (https://...) to embed directly",
          },
          file_id: {
            type: "string",
            description: "ID of a previously uploaded or generated file (use this if you have a file ID from upload or generate_image)",
          },
          alt: {
            type: "string",
            description: "Alt text / description of the image (for accessibility and caption)",
          },
        },
        required: [],
      },
    },
  },
  async execute(args) {
    const url = String(args.url || "");
    const fileId = String(args.file_id || "");
    const alt = String(args.alt || "image");

    if (!url && !fileId) {
      return "Error: provide either 'url' or 'file_id'";
    }

    let imageSrc: string;
    if (fileId) {
      // Verify the file exists in DB
      const file = await db.uploadedFile.findUnique({ where: { id: fileId } });
      if (!file) {
        return `Error: file not found with id ${fileId}`;
      }
      imageSrc = `/api/files/${fileId}`;
    } else {
      imageSrc = url;
    }

    const markdown = `![${alt}](${imageSrc})`;
    return markdown;
  },
};

// ---------- generate_image (enhanced, stream-injectable) ----------
// Generates an image via AI and returns markdown that the agent loop injects.
const generateImage: ToolExecutor = {
  definition: {
    type: "function",
    function: {
      name: "generate_image",
      description:
        "Generate an image from a text prompt using AI and inject it directly into your response. The image appears instantly in the chat — you do NOT need to write any markdown. Use this when the user asks for an image, illustration, diagram, or visual content.",
      parameters: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description: "Detailed description of the image to generate. Include style, subject, details, and quality terms.",
          },
          size: {
            type: "string",
            description: "Image size. Options: 1024x1024 (square), 1344x768 (landscape), 768x1344 (portrait), 1440x720 (wide), 720x1440 (tall). Default: 1024x1024",
          },
          alt: {
            type: "string",
            description: "Alt text / caption for the image (optional, defaults to the prompt)",
          },
        },
        required: ["prompt"],
      },
    },
  },
  async execute(args) {
    const prompt = String(args.prompt || "");
    const size = String(args.size || "1024x1024");
    const alt = String(args.alt || prompt.slice(0, 50));
    if (!prompt) return "Error: prompt is required";

    const validSizes = ["1024x1024", "1344x768", "768x1344", "1440x720", "720x1440", "864x1152", "1152x864"];
    const finalSize = validSizes.includes(size) ? size : "1024x1024";

    try {
      const ZAI = (await import("z-ai-web-dev-sdk")).default;
      const zai = await ZAI.create();
      const response = await zai.images.generations.create({
        prompt,
        size: finalSize as any,
      });

      const imageBase64 = response.data[0].base64;
      const buffer = Buffer.from(imageBase64, "base64");

      const imageId = crypto.randomUUID();
      const filename = `${imageId}.png`;
      const storagePath = path.resolve(process.cwd(), "uploads", filename);
      await fs.mkdir(path.dirname(storagePath), { recursive: true });
      await fs.writeFile(storagePath, buffer);

      await db.uploadedFile.create({
        data: {
          id: imageId,
          filename: `generated-${prompt.slice(0, 30).replace(/[^a-zA-Z0-9]/g, "-")}.png`,
          mimeType: "image/png",
          size: buffer.length,
          storagePath,
          extractedText: `AI-generated image: ${prompt}`,
          extracted: true,
        },
      });

      // Return just the markdown — the agent loop injects it into the stream.
      const markdown = `![${alt}](/api/files/${imageId})`;
      return markdown;
    } catch (e) {
      return `Image generation error: ${(e as Error).message}`;
    }
  },
};

// Set of tool names whose result content should be auto-injected into the
// response stream as a text chunk. The agent loop checks this set.
export const STREAM_INJECT_TOOLS = new Set<string>([
  "create_table",
  "embed_image",
  "generate_image",
]);

export const streamTools: Record<string, ToolExecutor> = {
  create_table: createTable,
  embed_image: embedImage,
  generate_image: generateImage,
};
