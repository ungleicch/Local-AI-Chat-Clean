// src/lib/tools-search.ts
// Dedicated search tools — image search, news search, Wikipedia search.
// These complement the always-available web_search with more focused queries.

import type { ToolDefinition } from "./types";
import type { ToolExecutor } from "./tools";
import {
  searchDuckDuckGoImages,
  searchWikimediaCommons,
  searchWikipedia,
  fetchWikipediaExtract,
} from "./search-utils";

// ---------- Image Search ----------
// Searches multiple sources (Wikimedia Commons + DuckDuckGo) and returns a
// list of image URLs with metadata. The agent can then pass one of those URLs
// to embed_image to actually render it in the response.
const imageSearch: ToolExecutor = {
  definition: {
    type: "function",
    function: {
      name: "image_search",
      description:
        "Search the web for images matching a query. Returns a list of image URLs with titles and source info. To actually display one of the images in your response, pass the URL to embed_image (mode: 'url') or pass the query directly to embed_image (mode: 'query'). Use this when the user wants to FIND/BROWSE images rather than display a single one.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query (e.g. 'Eiffel Tower', 'red panda', 'solar panel diagram')",
          },
          max_results: {
            type: "number",
            description: "Maximum number of results per source (default 4)",
          },
          source: {
            type: "string",
            enum: ["all", "wikimedia", "duckduckgo"],
            description: "Which image source to use. 'wikimedia' = public-domain/CC images (most reliable). 'duckduckgo' = broader but less reliable. Default: 'all'.",
          },
        },
        required: ["query"],
      },
    },
  },
  async execute(args) {
    const query = String(args.query || "").trim();
    const maxPer = Math.min(Number(args.max_results) || 4, 8);
    const source = String(args.source || "all");
    if (!query) return "Error: query is required";

    const tasks: Promise<Array<{ url: string; title: string; source: string; license?: string }>>[] = [];
    if (source === "all" || source === "wikimedia") {
      tasks.push(
        searchWikimediaCommons(query, maxPer).then((rs) =>
          rs.map((r) => ({ url: r.url, title: r.title || query, source: r.source || "Wikimedia", license: r.license }))
        )
      );
    }
    if (source === "all" || source === "duckduckgo") {
      tasks.push(
        searchDuckDuckGoImages(query, maxPer).then((rs) =>
          rs.map((r) => ({ url: r.url, title: r.title || query, source: r.source || "DuckDuckGo" }))
        )
      );
    }

    const results = (await Promise.all(tasks)).flat();
    if (results.length === 0) {
      return `No images found for "${query}". Try a different query or use generate_image to create one.`;
    }
    return results
      .map((r, i) => `${i + 1}. ${r.title}\n   URL: ${r.url}\n   Source: ${r.source}${r.license ? ` (${r.license})` : ""}`)
      .join("\n\n");
  },
};

// ---------- News Search ----------
const newsSearch: ToolExecutor = {
  definition: {
    type: "function",
    function: {
      name: "news_search",
      description:
        "Search recent news articles via Google News RSS. Returns titles, URLs, sources, dates, and snippets. Use this when the user asks about current events, breaking news, or recent developments on a topic.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "News search query (e.g. 'AI regulation', 'OpenAI', 'Tesla earnings')",
          },
          max_results: {
            type: "number",
            description: "Maximum number of results (default 6)",
          },
        },
        required: ["query"],
      },
    },
  },
  async execute(args) {
    const query = String(args.query || "").trim();
    const max = Math.min(Number(args.max_results) || 6, 15);
    if (!query) return "Error: query is required";
    // Lazy import to avoid circular dependency issues
    const { searchGoogleNews } = await import("./search-utils");
    const results = await searchGoogleNews(query, max);
    if (results.length === 0) {
      return `No recent news found for "${query}".`;
    }
    return results
      .map(
        (r, i) =>
          `${i + 1}. ${r.title}\n   URL: ${r.url}\n   Source: ${r.source}${r.date ? ` (${r.date})` : ""}\n   ${r.snippet}`
      )
      .join("\n\n");
  },
};

// ---------- Wikipedia Search ----------
// Returns full extracts for Wikipedia articles — much higher quality than
// snippets for factual questions.
const wikipediaSearch: ToolExecutor = {
  definition: {
    type: "function",
    function: {
      name: "wikipedia_search",
      description:
        "Search Wikipedia for encyclopedic articles. Returns matching article titles, URLs, and short snippets. For the full article text, use web_fetch on the URL or call wikipedia_read with the title.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query",
          },
          max_results: {
            type: "number",
            description: "Maximum number of results (default 3)",
          },
        },
        required: ["query"],
      },
    },
  },
  async execute(args) {
    const query = String(args.query || "").trim();
    const max = Math.min(Number(args.max_results) || 3, 8);
    if (!query) return "Error: query is required";
    const results = await searchWikipedia(query, max);
    if (results.length === 0) {
      return `No Wikipedia articles found for "${query}".`;
    }
    return results
      .map(
        (r, i) =>
          `${i + 1}. ${r.title}\n   URL: ${r.url}\n   ${r.snippet}`
      )
      .join("\n\n");
  },
};

// ---------- Wikipedia Read ----------
// Fetches the full plain-text extract of a Wikipedia article by title.
const wikipediaRead: ToolExecutor = {
  definition: {
    type: "function",
    function: {
      name: "wikipedia_read",
      description:
        "Read the full plain-text extract of a Wikipedia article by its exact title. Use wikipedia_search first to find article titles. Returns the article text (truncated to ~12000 chars).",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Exact Wikipedia article title (e.g. 'Albert Einstein', 'Quantum mechanics')",
          },
        },
        required: ["title"],
      },
    },
  },
  async execute(args) {
    const title = String(args.title || "").trim();
    if (!title) return "Error: title is required";
    const extract = await fetchWikipediaExtract(title);
    if (!extract) {
      return `Could not fetch Wikipedia article "${title}". Check the title or use wikipedia_search to find the exact title.`;
    }
    return extract.slice(0, 12000);
  },
};

export const searchTools: Record<string, ToolExecutor> = {
  image_search: imageSearch,
  news_search: newsSearch,
  wikipedia_search: wikipediaSearch,
  wikipedia_read: wikipediaRead,
};
