// src/lib/tools-embed.ts
// Rich media embed tools — YouTube videos, generic video, audio, etc.
//
// These tools return markdown that the agent loop injects into the response
// stream. The frontend markdown renderer detects the special syntax and
// renders the appropriate <iframe>, <video>, or <audio> element.
//
// Markdown conventions (must match the renderer in markdown.tsx):
//   • YouTube:      ![video](youtube:VIDEO_ID "title")
//   • Generic video:![video](video:URL "title")
//   • Audio:        ![audio](audio:URL "title")
//   • Link preview: ![preview](preview:URL "title")

import type { ToolDefinition } from "./types";
import type { ToolExecutor } from "./tools";
import { fetchWithUA, stripHtml } from "./search-utils";

// ---------- YouTube helpers ----------

// Extract a YouTube video ID from any common YouTube URL form:
//   • https://www.youtube.com/watch?v=VIDEO_ID
//   • https://youtu.be/VIDEO_ID
//   • https://www.youtube.com/embed/VIDEO_ID
//   • https://www.youtube.com/shorts/VIDEO_ID
//   • https://m.youtube.com/watch?v=VIDEO_ID
//   • VIDEO_ID  (bare 11-char ID)
// Returns null if no ID can be extracted.
export function extractYouTubeId(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  // Bare ID — must be exactly 11 chars of [A-Za-z0-9_-]
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  // youtu.be/ID
  const short = s.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
  if (short) return short[1];
  // watch?v=ID
  const watch = s.match(/[?&]v=([A-Za-z0-9_-]{11})/);
  if (watch) return watch[1];
  // /embed/ID or /shorts/ID or /v/ID or /live/ID
  const embed = s.match(/\/(?:embed|shorts|v|live)\/([A-Za-z0-9_-]{11})/);
  if (embed) return embed[1];
  return null;
}

// Fetch the YouTube video title + description via the no-key oEmbed endpoint.
// Returns null if the video is private, deleted, or unreachable.
async function fetchYouTubeMeta(videoId: string): Promise<{ title?: string; author?: string } | null> {
  try {
    const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`;
    const resp = await fetchWithUA(url, {}, { bot: true, timeoutMs: 8000 });
    if (!resp.ok) return null;
    const data: any = await resp.json();
    return { title: data.title, author: data.author_name };
  } catch {
    return null;
  }
}

// ---------- Embed YouTube ----------
// Embeds a YouTube video as a responsive iframe. Supports any YouTube URL
// form (watch, youtu.be, embed, shorts) plus bare video IDs.
const embedYouTube: ToolExecutor = {
  definition: {
    type: "function",
    function: {
      name: "embed_youtube",
      description:
        "Embed a YouTube video into your response. The video appears as a responsive iframe player in the chat. Accepts any YouTube URL form (watch?v=, youtu.be, /embed/, /shorts/) or a bare 11-character video ID. The title is auto-fetched via YouTube's oEmbed API. Use this when the user shares a YouTube link or asks to embed a video.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "YouTube URL or video ID. Accepts: https://www.youtube.com/watch?v=ID, https://youtu.be/ID, https://www.youtube.com/embed/ID, https://www.youtube.com/shorts/ID, or just the 11-char ID.",
          },
          title: {
            type: "string",
            description: "Optional caption / title to display under the video. If omitted, the video's real title is fetched automatically.",
          },
          start: {
            type: "number",
            description: "Optional start time in seconds (deep-link to a specific moment).",
          },
        },
        required: ["url"],
      },
    },
  },
  async execute(args) {
    const input = String(args.url || "").trim();
    if (!input) return "Error: url is required";
    const videoId = extractYouTubeId(input);
    if (!videoId) {
      return `Error: could not extract a YouTube video ID from "${input}". Expected a youtube.com/watch?v=URL, youtu.be/ID, or a bare 11-char video ID.`;
    }

    // Auto-fetch the title if not provided
    let title = String(args.title || "").trim();
    if (!title) {
      const meta = await fetchYouTubeMeta(videoId);
      if (meta?.title) title = meta.title;
    }
    const start = Number(args.start) || 0;
    const startParam = start > 0 ? `&start=${Math.floor(start)}` : "";

    // Special markdown the renderer recognises.
    // Format: ![video](youtube:VIDEO_ID "title")
    return `![video](youtube:${videoId}${startParam} "${title || "YouTube video"}")`;
  },
};

// ---------- Embed Video ----------
// Embeds a direct video URL (mp4, webm, ogg) as an HTML5 <video> element.
const embedVideo: ToolExecutor = {
  definition: {
    type: "function",
    function: {
      name: "embed_video",
      description:
        "Embed a direct video file URL (mp4, webm, ogg) into your response as an HTML5 video player. Use this when the user shares a direct video file link (NOT a YouTube link — use embed_youtube for those).",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "Direct video file URL (must end in .mp4, .webm, .ogg, or have video/* content-type).",
          },
          title: {
            type: "string",
            description: "Optional caption / title to display under the video.",
          },
        },
        required: ["url"],
      },
    },
  },
  async execute(args) {
    const url = String(args.url || "").trim();
    if (!url) return "Error: url is required";
    const title = String(args.title || "").trim();
    // Basic sanity check — must look like a URL
    if (!/^https?:\/\//i.test(url)) {
      return `Error: url must be a full http(s) URL, got "${url}"`;
    }
    return `![video](video:${url} "${title || "Video"}")`;
  },
};

// ---------- Embed Audio ----------
// Embeds a direct audio URL (mp3, wav, ogg, m4a) as an HTML5 <audio> element.
const embedAudio: ToolExecutor = {
  definition: {
    type: "function",
    function: {
      name: "embed_audio",
      description:
        "Embed a direct audio file URL (mp3, wav, ogg, m4a) into your response as an HTML5 audio player. Use this when the user shares a direct audio link or when you generate audio content.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "Direct audio file URL.",
          },
          title: {
            type: "string",
            description: "Optional caption / title to display under the audio player.",
          },
        },
        required: ["url"],
      },
    },
  },
  async execute(args) {
    const url = String(args.url || "").trim();
    if (!url) return "Error: url is required";
    const title = String(args.title || "").trim();
    if (!/^https?:\/\//i.test(url)) {
      return `Error: url must be a full http(s) URL, got "${url}"`;
    }
    return `![audio](audio:${url} "${title || "Audio"}")`;
  },
};

// ---------- Embed Link Preview ----------
// Fetches a URL's Open Graph metadata and renders a card-style preview.
const embedLinkPreview: ToolExecutor = {
  definition: {
    type: "function",
    function: {
      name: "embed_link_preview",
      description:
        "Embed a rich link preview card for any URL. Fetches the page's Open Graph / Twitter Card metadata (title, description, image) and renders it as a clickable card. Use this when the user shares a link and you want to show a preview rather than just a plain hyperlink.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "The URL to preview.",
          },
        },
        required: ["url"],
      },
    },
  },
  async execute(args) {
    const url = String(args.url || "").trim();
    if (!url) return "Error: url is required";
    if (!/^https?:\/\//i.test(url)) {
      return `Error: url must be a full http(s) URL, got "${url}"`;
    }
    try {
      const resp = await fetchWithUA(url, { redirect: "follow" }, { timeoutMs: 12000 });
      if (!resp.ok) {
        // Fallback to plain link
        return `[${url}](${url})`;
      }
      const html = await resp.text();
      const getMeta = (re: RegExp): string | null => {
        const m = html.match(re);
        return m ? stripHtml(m[1]).trim() : null;
      };
      const ogTitle =
        getMeta(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
        getMeta(/<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i) ||
        html.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim() ||
        url;
      const ogDesc =
        getMeta(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) ||
        getMeta(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ||
        "";
      const ogImage =
        getMeta(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
        getMeta(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i) ||
        "";
      // Resolve relative image URLs
      let imageUrl = ogImage;
      if (imageUrl && !/^https?:\/\//i.test(imageUrl)) {
        try {
          imageUrl = new URL(imageUrl, url).href;
        } catch {
          imageUrl = "";
        }
      }
      // Special markdown the renderer recognises.
      // Format: ![preview](preview:URL "title|description|imageURL")
      const parts = [ogTitle, ogDesc, imageUrl].map((s) => (s || "").replace(/\|/g, "\\|"));
      return `![preview](preview:${url} "${parts.join("|")}")`;
    } catch (e) {
      // Fallback to plain link
      return `[${url}](${url})`;
    }
  },
};

export const embedTools: Record<string, ToolExecutor> = {
  embed_youtube: embedYouTube,
  embed_video: embedVideo,
  embed_audio: embedAudio,
  embed_link_preview: embedLinkPreview,
};
