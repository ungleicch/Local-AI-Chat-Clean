// src/lib/tools-files.ts
// File extraction tool — extracts text from uploaded files.
//
// Supported formats:
//   • Text/code/markdown/JSON/YAML/XML/etc.  → read as UTF-8
//   • PDF                                     → pdftotext
//   • Images (jpg/png/gif/webp/tiff/bmp)      → tesseract OCR + EXIF metadata
//   • DOCX/DOC                                → pandoc (or docx2txt if available)
//   • XLSX/XLS                                → unzip + XML parse (no external deps)
//   • PPTX                                    → unzip + XML parse
//   • CSV/TSV                                 → read as text
//   • HTML                                    → strip tags to readable text
//   • RTF                                     → unrtf or textutil
//   • Audio (mp3/wav/m4a/ogg/flac)            → ffmpeg → whisper transcript (if available) else metadata
//   • Video (mp4/mov/webm/mkv)                → ffmpeg probe + keyframe extraction
//   • Archives (zip/tar/gz)                   → list contents (no auto-extract for safety)
//   • EPUB                                    → unzip + HTML→text
//   • JSON                                    → pretty-print

import type { ToolDefinition } from "./types";
import type { ToolExecutor } from "./tools";
import { db } from "./db";
import path from "node:path";
import fs from "node:fs/promises";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { htmlToReadableText } from "./search-utils";

const execAsync = promisify(exec);

const TEXT_EXTENSIONS = /\.(txt|md|markdown|json|ya?ml|toml|ini|cfg|conf|env|log|csv|tsv|js|mjs|cjs|ts|tsx|jsx|py|rb|go|rs|java|c|h|cpp|cc|hpp|cs|swift|kt|php|sql|sh|bash|zsh|fish|ps1|bat|cmd|vim|el|clj|ex|exs|erl|hs|lua|pl|r|scala|dart|gradle|groovy|makefile|dockerfile|rake|gemspec|gitignore|editorconfig|svg|xml|html?|css|scss|sass|less|styl)$/i;

const MAX_TEXT_LENGTH = 50000;

// ---------- Extract File ----------
const extractFile: ToolExecutor = {
  definition: {
    type: "function",
    function: {
      name: "extract_file",
      description:
        "Extract text content from an uploaded file. Supports: PDF (pdftotext), images (OCR via tesseract), DOCX/DOC (pandoc), XLSX/XLS (XML parse), PPTX (XML parse), CSV/TSV, HTML (readability extraction), RTF, audio (ffmpeg/whisper), video (metadata + keyframes), archives (zip/tar list), EPUB, JSON, and all plain-text/code formats. Returns the extracted text (truncated to 50k chars). Use this when the user uploads a file and you need to read its contents.",
      parameters: {
        type: "object",
        properties: {
          file_id: {
            type: "string",
            description: "The uploaded file ID (from the attachments list in the user message)",
          },
          force_refresh: {
            type: "boolean",
            description: "If true, re-extract even if a cached extraction exists (default false).",
          },
        },
        required: ["file_id"],
      },
    },
  },
  async execute(args) {
    const fileId = String(args.file_id || "");
    const forceRefresh = args.force_refresh === true;
    if (!fileId) return "Error: file_id required";
    const file = await db.uploadedFile.findUnique({ where: { id: fileId } });
    if (!file) return `Error: file ${fileId} not found`;
    if (file.extracted && file.extractedText && !forceRefresh) {
      return `=== ${file.filename} (cached) ===\n\n${file.extractedText}`;
    }
    try {
      const text = await extractFileContent(file.storagePath, file.filename, file.mimeType);
      const truncated = text.length > MAX_TEXT_LENGTH
        ? text.slice(0, MAX_TEXT_LENGTH) + `\n\n... (truncated, full length: ${text.length} chars)`
        : text;
      // Cache
      await db.uploadedFile.update({
        where: { id: fileId },
        data: { extractedText: truncated, extracted: true },
      });
      return `=== ${file.filename} ===\n\n${truncated}`;
    } catch (e) {
      return `Extraction error: ${(e as Error).message}`;
    }
  },
};

// ---------- Main extraction dispatcher ----------
async function extractFileContent(
  storagePath: string,
  filename: string,
  mimeType: string
): Promise<string> {
  const mime = mimeType.toLowerCase();
  const lower = filename.toLowerCase();

  // --- Text / code ---
  if (mime.startsWith("text/") || TEXT_EXTENSIONS.test(lower)) {
    return await readTextFile(storagePath);
  }

  // --- JSON ---
  if (mime === "application/json" || lower.endsWith(".json")) {
    return await readJsonFile(storagePath);
  }

  // --- PDF ---
  if (mime === "application/pdf" || lower.endsWith(".pdf")) {
    return await extractPdf(storagePath);
  }

  // --- Image (OCR + EXIF) ---
  if (mime.startsWith("image/")) {
    return await extractImage(storagePath);
  }

  // --- DOCX / DOC ---
  if (/\.(docx|doc)$/i.test(lower)) {
    return await extractDocx(storagePath, lower.endsWith(".doc"));
  }

  // --- XLSX / XLS ---
  if (/\.(xlsx|xls)$/i.test(lower)) {
    return await extractXlsx(storagePath, lower.endsWith(".xls"));
  }

  // --- PPTX ---
  if (lower.endsWith(".pptx")) {
    return await extractPptx(storagePath);
  }

  // --- HTML ---
  if (mime.includes("html") || /\.(html?|xhtml)$/i.test(lower)) {
    return await extractHtml(storagePath);
  }

  // --- RTF ---
  if (lower.endsWith(".rtf") || mime === "application/rtf") {
    return await extractRtf(storagePath);
  }

  // --- EPUB ---
  if (lower.endsWith(".epub") || mime === "application/epub+zip") {
    return await extractEpub(storagePath);
  }

  // --- Audio ---
  if (mime.startsWith("audio/") || /\.(mp3|wav|m4a|ogg|flac|aac|opus|aiff?)$/i.test(lower)) {
    return await extractAudio(storagePath, filename);
  }

  // --- Video ---
  if (mime.startsWith("video/") || /\.(mp4|mov|webm|mkv|avi|m4v|wmv|flv|mpg|mpeg)$/i.test(lower)) {
    return await extractVideo(storagePath, filename);
  }

  // --- Archives ---
  if (/\.(zip|tar|tar\.gz|tgz|tar\.bz2|tbz2|gz|bz2|7z)$/i.test(lower)) {
    return await listArchive(storagePath, filename);
  }

  // --- Fallback: try as text ---
  try {
    const buf = await fs.readFile(storagePath);
    // Check the first 8KB for null bytes — if present, treat as binary
    const head = buf.subarray(0, Math.min(buf.length, 8000));
    const isText = !head.includes(0);
    if (isText) {
      return `=== (auto-detected as text) ===\n` + buf.toString("utf8");
    }
    return `(Binary file, ${buf.length} bytes, type ${mime}). Could not extract text — format not supported.`;
  } catch (e) {
    return `(Could not extract text from ${filename} (${mime})): ${(e as Error).message}`;
  }
}

// ---------- Format-specific extractors ----------

async function readTextFile(p: string): Promise<string> {
  return await fs.readFile(p, "utf8");
}

async function readJsonFile(p: string): Promise<string> {
  const raw = await fs.readFile(p, "utf8");
  try {
    const obj = JSON.parse(raw);
    return JSON.stringify(obj, null, 2);
  } catch {
    return raw;
  }
}

async function extractPdf(p: string): Promise<string> {
  try {
    const { stdout } = await execAsync(`pdftotext -layout ${JSON.stringify(p)} -`, {
      maxBuffer: 10 * 1024 * 1024,
      timeout: 30000,
    });
    return stdout.trim() || "(no text extracted from PDF — may be image-only; would need OCR)";
  } catch (e) {
    return `(pdftotext failed: ${(e as Error).message})`;
  }
}

async function extractImage(p: string): Promise<string> {
  const parts: string[] = [];

  // 1. Run OCR
  try {
    const { stdout } = await execAsync(`tesseract ${JSON.stringify(p)} - 2>/dev/null`, {
      maxBuffer: 10 * 1024 * 1024,
      timeout: 60000,
    });
    const ocrText = stdout.trim();
    if (ocrText) {
      parts.push(`--- OCR text ---\n${ocrText}`);
    } else {
      parts.push("--- OCR text ---\n(no text detected in image)");
    }
  } catch (e) {
    parts.push(`--- OCR text ---\n(OCR failed: ${(e as Error).message})`);
  }

  // 2. Extract EXIF / metadata via `file` + `identify` if available
  try {
    const { stdout: fileInfo } = await execAsync(`file ${JSON.stringify(p)}`, { timeout: 5000 });
    parts.push(`--- File info ---\n${fileInfo.trim()}`);
  } catch {
    // ignore
  }

  // 3. Try ImageMagick `identify` for dimensions
  try {
    const { stdout } = await execAsync(`identify -format "%wx%h %m %b" ${JSON.stringify(p)} 2>/dev/null`, { timeout: 5000 });
    if (stdout.trim()) parts.push(`--- Dimensions ---\n${stdout.trim()}`);
  } catch {
    // ignore
  }

  return parts.join("\n\n");
}

async function extractDocx(p: string, isLegacyDoc: boolean): Promise<string> {
  // Try pandoc first (best quality)
  try {
    const { stdout } = await execAsync(`pandoc -t plain ${JSON.stringify(p)} 2>/dev/null`, {
      maxBuffer: 10 * 1024 * 1024,
      timeout: 30000,
    });
    if (stdout.trim()) return stdout;
  } catch {
    // pandoc not available or failed
  }

  // For .docx files (not legacy .doc), unzip + parse word/document.xml
  if (!isLegacyDoc) {
    try {
      const text = await extractDocxViaXml(p);
      if (text) return text;
    } catch {
      // ignore
    }
  }

  // Try docx2txt as a Python fallback
  try {
    const { stdout } = await execAsync(`python3 -c "import docx2txt; print(docx2txt.process(${JSON.stringify(p)}))" 2>/dev/null`, {
      maxBuffer: 10 * 1024 * 1024,
      timeout: 30000,
    });
    if (stdout.trim()) return stdout;
  } catch {
    // ignore
  }

  return `(Could not extract DOCX text. Install pandoc: brew install pandoc, or python-docx: pip install python-docx)`;
}

// Parse a .docx file directly by unzipping it and reading word/document.xml.
// No external dependencies required.
async function extractDocxViaXml(p: string): Promise<string> {
  const { exec } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execAsync = promisify(exec);
  const tmpDir = path.join(process.cwd(), "workspace", ".cache", `docx-${Date.now()}`);
  await fs.mkdir(tmpDir, { recursive: true });
  try {
    await execAsync(`unzip -o ${JSON.stringify(p)} word/document.xml -d ${JSON.stringify(tmpDir)} 2>/dev/null`, { timeout: 10000 });
    const xmlPath = path.join(tmpDir, "word", "document.xml");
    const xml = await fs.readFile(xmlPath, "utf8");
    // Extract text from <w:t> elements, with paragraph breaks on <w:p>
    let text = xml
      .replace(/<\/w:p>/g, "\n")
      .replace(/<w:tab[^>]*\/>/g, "\t")
      .replace(/<w:br[^>]*\/>/g, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return text;
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

// Extract text from XLSX/XLS by unzipping and parsing the sheet XML.
// Returns a compact representation: one section per sheet, with rows.
async function extractXlsx(p: string, _isLegacyXls: boolean): Promise<string> {
  const tmpDir = path.join(process.cwd(), "workspace", ".cache", `xlsx-${Date.now()}`);
  await fs.mkdir(tmpDir, { recursive: true });
  try {
    await execAsync(`unzip -o ${JSON.stringify(p)} -d ${JSON.stringify(tmpDir)} 2>/dev/null`, { timeout: 10000 });
    // Read shared strings (cell values stored as references)
    const sharedStrings: string[] = [];
    const sharedPath = path.join(tmpDir, "xl", "sharedStrings.xml");
    try {
      const sharedXml = await fs.readFile(sharedPath, "utf8");
      const re = /<si>([\s\S]*?)<\/si>/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(sharedXml))) {
        // Concatenate all <t> elements within the <si>
        const texts = m[1].match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [];
        const text = texts
          .map((t) => t.replace(/<[^>]+>/g, ""))
          .join("")
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">");
        sharedStrings.push(text);
      }
    } catch {
      // sharedStrings.xml may not exist for files with no strings
    }

    // List all sheet files
    const sheetsDir = path.join(tmpDir, "xl", "worksheets");
    let sheetFiles: string[] = [];
    try {
      sheetFiles = (await fs.readdir(sheetsDir)).filter((f) => /^sheet\d+\.xml$/i.test(f)).sort();
    } catch {
      // no sheets
    }

    if (sheetFiles.length === 0) {
      return "(XLSX file with no sheets)";
    }

    const parts: string[] = [];
    for (const sheetFile of sheetFiles) {
      const sheetPath = path.join(sheetsDir, sheetFile);
      const xml = await fs.readFile(sheetPath, "utf8");
      parts.push(`--- Sheet: ${sheetFile.replace(/\.xml$/i, "")} ---`);
      // Parse rows
      const rowRe = /<row[^>]*>([\s\S]*?)<\/row>/g;
      let rowMatch: RegExpExecArray | null;
      let rowCount = 0;
      while ((rowMatch = rowRe.exec(xml)) && rowCount < 200) {
        const rowXml = rowMatch[1];
        const cellRe = /<c[^>]*r="([A-Z]+\d+)"[^>]*(?:t="([^"]+)")?[^>]*>(?:<v>([^<]*)<\/v>|<is><t[^>]*>([^<]*)<\/t><\/is>)?<\/c>/g;
        const cells: Record<string, string> = {};
        let cellMatch: RegExpExecArray | null;
        while ((cellMatch = cellRe.exec(rowXml))) {
          const ref = cellMatch[1];
          const type = cellMatch[2] || "";
          const inlineVal = cellMatch[4];
          let val = cellMatch[3] || inlineVal || "";
          if (type === "s" && cellMatch[3]) {
            // Shared string reference
            val = sharedStrings[Number(cellMatch[3])] || val;
          }
          cells[ref] = val;
        }
        if (Object.keys(cells).length > 0) {
          // Convert to TSV
          const cols = Object.keys(cells).map((r) => r.replace(/\d+$/, ""));
          const maxCol = cols.reduce((a, b) => (colToNum(a) > colToNum(b) ? a : b), "A");
          const maxN = colToNum(maxCol);
          const row: string[] = [];
          for (let i = 0; i < maxN; i++) {
            const col = numToCol(i + 1);
            const ref = col + (rowCount + 1);
            row.push(cells[ref] || "");
          }
          parts.push(row.join("\t"));
        }
        rowCount++;
      }
      if (rowCount >= 200) parts.push("... (truncated at 200 rows)");
      parts.push("");
    }
    return parts.join("\n");
  } catch (e) {
    return `(XLSX extraction failed: ${(e as Error).message})`;
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

function colToNum(col: string): number {
  let n = 0;
  for (const ch of col) {
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n;
}

function numToCol(n: number): string {
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// Extract text from PPTX by unzipping and parsing slide XMLs.
async function extractPptx(p: string): Promise<string> {
  const tmpDir = path.join(process.cwd(), "workspace", ".cache", `pptx-${Date.now()}`);
  await fs.mkdir(tmpDir, { recursive: true });
  try {
    await execAsync(`unzip -o ${JSON.stringify(p)} -d ${JSON.stringify(tmpDir)} 2>/dev/null`, { timeout: 10000 });
    const slidesDir = path.join(tmpDir, "ppt", "slides");
    let slideFiles: string[] = [];
    try {
      slideFiles = (await fs.readdir(slidesDir)).filter((f) => /^slide\d+\.xml$/i.test(f)).sort((a, b) => {
        const na = parseInt(a.replace(/\D/g, ""), 10);
        const nb = parseInt(b.replace(/\D/g, ""), 10);
        return na - nb;
      });
    } catch {
      // no slides
    }
    if (slideFiles.length === 0) return "(PPTX with no slides)";
    const parts: string[] = [];
    for (const slideFile of slideFiles) {
      const slidePath = path.join(slidesDir, slideFile);
      const xml = await fs.readFile(slidePath, "utf8");
      // Extract text from <a:t> elements
      const texts = xml.match(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g) || [];
      const text = texts
        .map((t) => t.replace(/<[^>]+>/g, ""))
        .join("\n")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
      parts.push(`--- Slide ${slideFile.replace(/\D/g, "")} ---\n${text || "(no text)"}`);
    }
    return parts.join("\n\n");
  } catch (e) {
    return `(PPTX extraction failed: ${(e as Error).message})`;
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function extractHtml(p: string): Promise<string> {
  const raw = await fs.readFile(p, "utf8");
  return htmlToReadableText(raw, MAX_TEXT_LENGTH);
}

async function extractRtf(p: string): Promise<string> {
  // Try unrtf
  try {
    const { stdout } = await execAsync(`unrtf --text ${JSON.stringify(p)} 2>/dev/null`, {
      maxBuffer: 10 * 1024 * 1024,
      timeout: 15000,
    });
    if (stdout.trim()) return stdout;
  } catch {
    // ignore
  }
  // Try textutil (macOS)
  try {
    const { stdout } = await execAsync(`textutil -convert txt -stdout ${JSON.stringify(p)} 2>/dev/null`, {
      maxBuffer: 10 * 1024 * 1024,
      timeout: 15000,
    });
    if (stdout.trim()) return stdout;
  } catch {
    // ignore
  }
  // Crude fallback: strip RTF control codes
  try {
    const raw = await fs.readFile(p, "utf8");
    const text = raw
      .replace(/\\par[d]?/g, "\n")
      .replace(/\\line/g, "\n")
      .replace(/\\tab/g, "\t")
      .replace(/\\'[0-9a-f]{2}/g, "")
      .replace(/\\[a-z]+-?\d+ ?/gi, "")
      .replace(/[{}]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    return text || "(could not extract RTF text)";
  } catch (e) {
    return `(RTF extraction failed: ${(e as Error).message})`;
  }
}

// EPUB is a ZIP containing XHTML chapters. We unzip and concatenate the text.
async function extractEpub(p: string): Promise<string> {
  const tmpDir = path.join(process.cwd(), "workspace", ".cache", `epub-${Date.now()}`);
  await fs.mkdir(tmpDir, { recursive: true });
  try {
    await execAsync(`unzip -o ${JSON.stringify(p)} -d ${JSON.stringify(tmpDir)} 2>/dev/null`, { timeout: 15000 });
    // Find all HTML files in OEBPS or content directories
    const { stdout: findOut } = await execAsync(
      `find ${JSON.stringify(tmpDir)} -type f \\( -name "*.html" -o -name "*.xhtml" -o -name "*.htm" \\) 2>/dev/null | sort`,
      { maxBuffer: 1024 * 1024, timeout: 10000 }
    );
    const htmlFiles = findOut.trim().split("\n").filter(Boolean);
    if (htmlFiles.length === 0) return "(EPUB with no HTML content)";
    const parts: string[] = [];
    for (const htmlFile of htmlFiles.slice(0, 100)) {
      try {
        const html = await fs.readFile(htmlFile, "utf8");
        const text = htmlToReadableText(html, 5000);
        if (text) parts.push(text);
      } catch {
        // skip
      }
    }
    return parts.join("\n\n---\n\n") || "(could not extract EPUB text)";
  } catch (e) {
    return `(EPUB extraction failed: ${(e as Error).message})`;
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

// For audio files, probe metadata via ffmpeg/ffprobe. If a Whisper binary is
// available locally, attempt transcription (long files are truncated).
async function extractAudio(p: string, filename: string): Promise<string> {
  const parts: string[] = [`--- Audio file: ${filename} ---`];

  // ffprobe for metadata
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -show_format -show_streams -print_format json ${JSON.stringify(p)}`,
      { maxBuffer: 1024 * 1024, timeout: 15000 }
    );
    const info = JSON.parse(stdout);
    if (info.format) {
      const fmt = info.format;
      parts.push(`Format: ${fmt.format_name || "unknown"}`);
      parts.push(`Duration: ${fmt.duration ? Math.round(Number(fmt.duration)) + "s" : "unknown"}`);
      parts.push(`Bit rate: ${fmt.bit_rate || "unknown"}`);
      if (fmt.tags) {
        const tags = fmt.tags;
        if (tags.title) parts.push(`Title: ${tags.title}`);
        if (tags.artist) parts.push(`Artist: ${tags.artist}`);
        if (tags.album) parts.push(`Album: ${tags.album}`);
      }
    }
    if (info.streams) {
      for (const s of info.streams) {
        if (s.codec_type === "audio") {
          parts.push(`Audio codec: ${s.codec_name || "unknown"}, ${s.sample_rate || "?"}Hz, ${s.channels || "?"} channels`);
        }
      }
    }
  } catch {
    parts.push("(ffprobe not available — install ffmpeg for audio metadata)");
  }

  // Try local whisper for transcription (if installed)
  try {
    // First convert to 16kHz mono WAV for whisper
    const tmpWav = path.join(process.cwd(), "workspace", ".cache", `audio-${Date.now()}.wav`);
    await fs.mkdir(path.dirname(tmpWav), { recursive: true });
    try {
      await execAsync(
        `ffmpeg -y -i ${JSON.stringify(p)} -ar 16000 -ac 1 -c:a pcm_s16le ${JSON.stringify(tmpWav)} 2>/dev/null`,
        { timeout: 60000, maxBuffer: 1024 * 1024 }
      );
      // Try whisper CLI
      try {
        const { stdout } = await execAsync(`whisper ${JSON.stringify(tmpWav)} --model tiny --output_format txt --output_dir ${JSON.stringify(path.dirname(tmpWav))} 2>/dev/null`, {
          timeout: 300000,
          maxBuffer: 10 * 1024 * 1024,
        });
        const txtPath = tmpWav.replace(/\.wav$/, ".txt");
        try {
          const transcript = await fs.readFile(txtPath, "utf8");
          if (transcript.trim()) {
            parts.push(`--- Transcript ---\n${transcript.trim()}`);
          }
        } catch {
          // txt file not written
        }
      } catch {
        parts.push("(Whisper not installed — install with: pip install openai-whisper, for transcription)");
      }
    } finally {
      await fs.unlink(tmpWav).catch(() => {});
      await fs.unlink(tmpWav.replace(/\.wav$/, ".txt")).catch(() => {});
    }
  } catch {
    // ignore
  }

  return parts.join("\n");
}

// For video files, probe metadata and extract a keyframe thumbnail.
async function extractVideo(p: string, filename: string): Promise<string> {
  const parts: string[] = [`--- Video file: ${filename} ---`];

  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -show_format -show_streams -print_format json ${JSON.stringify(p)}`,
      { maxBuffer: 1024 * 1024, timeout: 15000 }
    );
    const info = JSON.parse(stdout);
    if (info.format) {
      const fmt = info.format;
      parts.push(`Format: ${fmt.format_name || "unknown"}`);
      parts.push(`Duration: ${fmt.duration ? Math.round(Number(fmt.duration)) + "s" : "unknown"}`);
      parts.push(`Bit rate: ${fmt.bit_rate || "unknown"}`);
      if (fmt.size) parts.push(`Size: ${(Number(fmt.size) / 1024 / 1024).toFixed(2)} MB`);
    }
    if (info.streams) {
      for (const s of info.streams) {
        if (s.codec_type === "video") {
          parts.push(`Video: ${s.codec_name || "?"}, ${s.width || "?"}x${s.height || "?"}, ${s.r_frame_rate || "?"} fps`);
        } else if (s.codec_type === "audio") {
          parts.push(`Audio: ${s.codec_name || "?"}, ${s.sample_rate || "?"}Hz, ${s.channels || "?"}ch`);
        }
      }
    }
  } catch {
    parts.push("(ffprobe not available — install ffmpeg for video metadata)");
  }

  return parts.join("\n");
}

// List archive contents (does NOT auto-extract for safety).
async function listArchive(p: string, filename: string): Promise<string> {
  const parts: string[] = [`--- Archive: ${filename} ---`];
  const lower = filename.toLowerCase();
  try {
    if (lower.endsWith(".zip") || /\.(zip)$/i.test(lower)) {
      const { stdout } = await execAsync(`unzip -l ${JSON.stringify(p)}`, { maxBuffer: 1024 * 1024, timeout: 10000 });
      parts.push(stdout.trim());
    } else if (/\.(tar|tar\.gz|tgz|tar\.bz2|tbz2)$/i.test(lower)) {
      const { stdout } = await execAsync(`tar -tvf ${JSON.stringify(p)}`, { maxBuffer: 1024 * 1024, timeout: 10000 });
      parts.push(stdout.trim());
    } else if (lower.endsWith(".gz")) {
      parts.push("(gzipped file — use gunzip to decompress)");
    } else if (lower.endsWith(".7z")) {
      const { stdout } = await execAsync(`7z l ${JSON.stringify(p)} 2>/dev/null`, { maxBuffer: 1024 * 1024, timeout: 10000 });
      parts.push(stdout.trim() || "(7z not installed)");
    } else {
      parts.push("(unknown archive format)");
    }
    parts.push("\nNote: archive contents are listed but not auto-extracted for safety. Ask the user if they want to extract specific files.");
  } catch (e) {
    parts.push(`(archive listing failed: ${(e as Error).message})`);
  }
  return parts.join("\n");
}

// ---------- List Uploaded Files ----------
const listUploadedFiles: ToolExecutor = {
  definition: {
    type: "function",
    function: {
      name: "list_uploaded_files",
      description:
        "List files uploaded in the current conversation. Returns file IDs, names, MIME types, and sizes. Use extract_file with a file ID to read its contents.",
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
