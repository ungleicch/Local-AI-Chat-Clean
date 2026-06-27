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
// Embeds an image into the response. Three modes:
//   1. query: search the web for an image and embed the first result
//   2. url: embed a specific public image URL
//   3. file_id: embed a previously uploaded/generated file
const embedImage: ToolExecutor = {
  definition: {
    type: "function",
    function: {
      name: "embed_image",
      description:
        "Embed an image into your response. The image appears instantly in the chat. THREE ways to use it:\n" +
        "1. **Find an image**: pass 'query' (e.g. 'a banana') — searches the web for a matching image and embeds it. Use this when the user says 'find me an image of X' or 'show me a picture of X'.\n" +
        "2. **Embed by URL**: pass 'url' (a direct https image link) to embed a specific image.\n" +
        "3. **Embed by file ID**: pass 'file_id' to embed a previously uploaded or generated file.\n" +
        "The image is downloaded and served locally so it won't break due to hotlink protection.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query to find an image on the web (e.g. 'a banana', 'Eiffel Tower', 'a cute cat'). Use this when the user wants to FIND or SHOW an image, not generate one.",
          },
          url: {
            type: "string",
            description: "A direct public image URL (https://...) to embed. Use this when you already have a specific image URL.",
          },
          file_id: {
            type: "string",
            description: "ID of a previously uploaded or generated file (from upload or generate_image)",
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
    const query = String(args.query || "");
    const url = String(args.url || "");
    const fileId = String(args.file_id || "");
    const alt = String(args.alt || query || "image");

    // --- Mode 3: embed by file_id ---
    if (fileId) {
      const file = await db.uploadedFile.findUnique({ where: { id: fileId } });
      if (!file) {
        return `Error: file not found with id ${fileId}`;
      }
      return `![${alt}](/api/files/${fileId})`;
    }

    // --- Mode 2: embed by URL ---
    if (url) {
      // Download and re-serve locally to avoid hotlink protection / CORS issues
      const localId = await downloadAndStoreImage(url);
      if (localId) {
        return `![${alt}](/api/files/${localId})`;
      }
      // Fallback: try embedding the URL directly
      return `![${alt}](${url})`;
    }

    // --- Mode 1: search the web for an image ---
    if (query) {
      const imageUrl = await searchForImage(query);
      if (!imageUrl) {
        return `Error: could not find an image for "${query}". Try a different query or use generate_image instead.`;
      }
      const localId = await downloadAndStoreImage(imageUrl);
      if (localId) {
        return `![${alt}](/api/files/${localId})`;
      }
      // Fallback: try embedding the original URL
      return `![${alt}](${imageUrl})`;
    }

    return "Error: provide one of 'query', 'url', or 'file_id'";
  },
};

/**
 * Search for an image matching the query.
 *
 * Tries Wikimedia Commons first (public domain / CC images, no hotlink
 * protection, reliable direct URLs) then falls back to DuckDuckGo image
 * search. Returns a direct image URL that can be downloaded.
 */
async function searchForImage(query: string): Promise<string | null> {
  // --- Source 1: Wikimedia Commons (most reliable) ---
  const wikiUrl = await searchWikimediaCommons(query);
  if (wikiUrl) return wikiUrl;

  // --- Source 2: DuckDuckGo image search (fallback) ---
  const ddgUrl = await searchDuckDuckGoImages(query);
  if (ddgUrl) return ddgUrl;

  return null;
}

/**
 * Search Wikimedia Commons for an image. Returns a direct image URL.
 * Wikimedia Commons images are public domain or Creative Commons licensed
 * and can be freely downloaded and served.
 */
async function searchWikimediaCommons(query: string): Promise<string | null> {
  try {
    // Use the generator=search with namespace 6 (File:) to find image files
    const apiUrl =
      `https://commons.wikimedia.org/w/api.php?action=query&format=json` +
      `&generator=search&gsrsearch=${encodeURIComponent(query)}` +
      `&gsrnamespace=6&gsrlimit=5&prop=imageinfo` +
      `&iiprop=url|mime|size&iiurlwidth=800`;

    const resp = await fetch(apiUrl, {
      headers: {
        "User-Agent":
          "LocalAIChatBot/1.0 (https://example.com; contact@example.com)",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) return null;

    const data = await resp.json();
    const pages = data?.query?.pages;
    if (!pages) return null;

    // Iterate pages, find the first one with a valid image URL
    for (const page of Object.values<any>(pages)) {
      const info = page.imageinfo?.[0];
      if (!info) continue;
      // Prefer the thumburl (resized) over the full url (can be huge)
      const url = info.thumburl || info.url;
      if (url && (info.mime?.startsWith("image/") || url.match(/\.(jpg|jpeg|png|gif|webp)/i))) {
        return url;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Search DuckDuckGo for images. Less reliable than Wikimedia (hotlink
 * protection, redirects) but covers a broader range of topics.
 */
async function searchDuckDuckGoImages(query: string): Promise<string | null> {
  try {
    const searchUrl = `https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`;
    const resp = await fetch(searchUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      },
      redirect: "follow",
    });
    if (!resp.ok) return null;
    const html = await resp.text();

    // Pattern 1: vqd-based image API (more reliable)
    const vqdMatch = html.match(/vqd=['"](\d+-\d+(?:-\d+)?)['"]/);
    if (vqdMatch) {
      const vqd = vqdMatch[1];
      const apiUrl = `https://duckduckgo.com/i.js?l=us-en&o=json&q=${encodeURIComponent(query)}&vqd=${vqd}&f=,,,,,&p=1`;
      const apiResp = await fetch(apiUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
          "Referer": "https://duckduckgo.com/",
        },
      });
      if (apiResp.ok) {
        const data = await apiResp.json();
        if (data.results && data.results.length > 0) {
          return data.results[0].image || data.results[0].thumbnail || null;
        }
      }
    }

    // Pattern 2: scrape image URLs from the HTML directly
    const imgMatches = html.match(/https?:\/\/[^"'\s]+\.(?:jpg|jpeg|png|gif|webp)/gi);
    if (imgMatches && imgMatches.length > 0) {
      const filtered = imgMatches.filter(
        (u) => !u.includes("favicon") && !u.includes("logo") && !u.includes("icon")
      );
      if (filtered.length > 0) return filtered[0];
      return imgMatches[0];
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Download an image from a URL and store it locally so it can be served
 * through /api/files/. Returns the file ID, or null on failure.
 *
 * The image is downloaded server-side (in the API route) so CORS doesn't
 * apply. It's then served from /api/files/ID which is same-origin, avoiding
 * OpaqueResponseBlocking (ORB) and hotlink protection issues.
 */
async function downloadAndStoreImage(imageUrl: string): Promise<string | null> {
  try {
    const resp = await fetch(imageUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        // Some image servers require an Accept header
        "Accept": "image/*,*/*;q=0.8",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
    });
    if (!resp.ok) return null;

    // Determine content type — fall back to URL extension if header missing
    let contentType = resp.headers.get("content-type") || "";
    if (!contentType.startsWith("image/")) {
      // Try to infer from URL
      if (imageUrl.match(/\.(jpg|jpeg)(\?|$)/i)) contentType = "image/jpeg";
      else if (imageUrl.match(/\.png(\?|$)/i)) contentType = "image/png";
      else if (imageUrl.match(/\.gif(\?|$)/i)) contentType = "image/gif";
      else if (imageUrl.match(/\.webp(\?|$)/i)) contentType = "image/webp";
      else return null; // Not an image
    }

    const buffer = Buffer.from(await resp.arrayBuffer());
    // Skip empty responses — but don't require a large minimum size
    // (some valid images like small thumbnails can be under 1KB)
    if (buffer.length < 100) return null;

    const ext = contentType.includes("png") ? "png"
      : contentType.includes("gif") ? "gif"
      : contentType.includes("webp") ? "webp"
      : "jpg";

    const imageId = crypto.randomUUID();
    const filename = `${imageId}.${ext}`;
    const storagePath = path.resolve(process.cwd(), "uploads", filename);
    await fs.mkdir(path.dirname(storagePath), { recursive: true });
    await fs.writeFile(storagePath, buffer);

    await db.uploadedFile.create({
      data: {
        id: imageId,
        filename: `web-image.${ext}`,
        mimeType: contentType,
        size: buffer.length,
        storagePath,
        extractedText: `Image from web: ${imageUrl}`,
        extracted: true,
      },
    });

    return imageId;
  } catch {
    return null;
  }
}

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
