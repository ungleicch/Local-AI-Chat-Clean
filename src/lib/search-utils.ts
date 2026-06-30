// src/lib/search-utils.ts
// Shared search utilities — used by web_search, image_search, news_search, etc.
//
// All network helpers live here so the individual tool modules can stay small
// and so we can swap providers without touching every tool.

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const BOT_USER_AGENT =
  "LocalAIChatBot/1.0 (https://github.com/ungleicch/Local-AI-Chat-Clean)";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source?: string;
}

export interface ImageResult {
  url: string;
  thumbUrl?: string;
  title?: string;
  source?: string;
  width?: number;
  height?: number;
  license?: string;
}

export interface NewsResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
  date?: string;
}

// ---------- Public helpers ----------

export function fetchWithUA(
  url: string,
  init: RequestInit = {},
  opts: { bot?: boolean; timeoutMs?: number } = {}
): Promise<Response> {
  const ua = opts.bot ? BOT_USER_AGENT : DEFAULT_USER_AGENT;
  const headers = new Headers(init.headers);
  if (!headers.has("User-Agent")) headers.set("User-Agent", ua);
  if (!headers.has("Accept")) headers.set("Accept", "*/*");
  return fetch(url, {
    ...init,
    headers,
    signal: opts.timeoutMs
      ? AbortSignal.timeout(opts.timeoutMs)
      : init.signal,
  });
}

// Decode HTML entities in a string. Used when cleaning scraped HTML.
export function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

// Strip all HTML tags from a string, collapse whitespace.
export function stripHtml(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<[^>]+>/g, " ")
  ).replace(/\s+/g, " ")
   .trim();
}

// ---------- DuckDuckGo (HTML) web search ----------
// The HTML endpoint is the most reliable no-API-key search. It changes its
// markup occasionally, so we parse defensively with multiple fallbacks.
export async function searchDuckDuckGoWeb(
  query: string,
  maxResults = 6
): Promise<SearchResult[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  try {
    const resp = await fetchWithUA(url, {
      redirect: "follow",
    }, { timeoutMs: 12000 });
    if (!resp.ok) return [];
    const html = await resp.text();
    const results: SearchResult[] = [];

    // Pattern 1: classic DDG HTML result blocks
    const blockRe = /<div class="result results_links results_links_deep web-result "[\s\S]*?<\/div>\s*<\/div>/g;
    let m: RegExpExecArray | null;
    while ((m = blockRe.exec(html)) && results.length < maxResults) {
      const block = m[0];
      const titleMatch = block.match(/<a[^>]*class="result__a"[^>]*>([\s\S]*?)<\/a>/);
      const urlMatch = block.match(/<a[^>]*class="result__a"[^>]*href="([^"]+)"/);
      const snippetMatch = block.match(/<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
      if (titleMatch && urlMatch) {
        const title = stripHtml(titleMatch[1]);
        let href = urlMatch[1];
        const uddg = href.match(/uddg=([^&]+)/);
        if (uddg) href = decodeURIComponent(uddg[1]);
        const snippet = snippetMatch ? stripHtml(snippetMatch[1]) : "";
        if (title && href) results.push({ title, url: href, snippet, source: "DuckDuckGo" });
      }
    }

    // Pattern 2: fallback — any anchor with result__a class
    if (results.length === 0) {
      const aRe = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
      while ((m = aRe.exec(html)) && results.length < maxResults) {
        let href = m[1];
        const uddg = href.match(/uddg=([^&]+)/);
        if (uddg) href = decodeURIComponent(uddg[1]);
        const title = stripHtml(m[2]);
        if (title && href) results.push({ title, url: href, snippet: "", source: "DuckDuckGo" });
      }
    }

    return results;
  } catch {
    return [];
  }
}

// ---------- DuckDuckGo image search ----------
// Uses the vqd-secured image API. The vqd token is parsed from the search HTML.
export async function searchDuckDuckGoImages(
  query: string,
  maxResults = 6
): Promise<ImageResult[]> {
  try {
    // 1. Load the search page to extract the vqd token
    const searchUrl = `https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`;
    const resp = await fetchWithUA(searchUrl, { redirect: "follow" }, { timeoutMs: 12000 });
    if (!resp.ok) return [];
    const html = await resp.text();

    // Try several vqd patterns — DDG changes these
    let vqd: string | null = null;
    const vqdPatterns = [
      /vqd=['"](\d+-\d+(?:-\d+)?)['"]/,
      /vqd=([\d-]+)/,
      /"vqd":"([\d-]+)"/,
      /vqd\s*=\s*["']([\d-]+)["']/,
    ];
    for (const re of vqdPatterns) {
      const m = html.match(re);
      if (m) { vqd = m[1]; break; }
    }
    if (!vqd) return [];

    // 2. Hit the image API
    const apiUrl =
      `https://duckduckgo.com/i.js?l=us-en&o=json&q=${encodeURIComponent(query)}` +
      `&vqd=${vqd}&f=,,,,,&p=1`;
    const apiResp = await fetchWithUA(apiUrl, {
      headers: { Referer: "https://duckduckgo.com/" },
    }, { timeoutMs: 12000 });
    if (!apiResp.ok) return [];
    const data: any = await apiResp.json();
    const list: any[] = data?.results || [];
    const out: ImageResult[] = [];
    for (const r of list) {
      if (out.length >= maxResults) break;
      out.push({
        url: r.image,
        thumbUrl: r.thumbnail || r.image,
        title: r.title || query,
        source: r.source || "DuckDuckGo",
        width: r.width,
        height: r.height,
      });
    }
    return out;
  } catch {
    return [];
  }
}

// ---------- Wikimedia Commons image search ----------
// Public-domain / CC-licensed images — most reliable for direct download.
export async function searchWikimediaCommons(
  query: string,
  maxResults = 6
): Promise<ImageResult[]> {
  try {
    const apiUrl =
      `https://commons.wikimedia.org/w/api.php?action=query&format=json` +
      `&generator=search&gsrsearch=${encodeURIComponent(query)}` +
      `&gsrnamespace=6&gsrlimit=${maxResults}&prop=imageinfo` +
      `&iiprop=url|mime|size|extmetadata&iiurlwidth=800`;
    const resp = await fetchWithUA(apiUrl, {}, { bot: true, timeoutMs: 10000 });
    if (!resp.ok) return [];
    const data: any = await resp.json();
    const pages = data?.query?.pages;
    if (!pages) return [];
    const out: ImageResult[] = [];
    for (const page of Object.values<any>(pages)) {
      const info = page.imageinfo?.[0];
      if (!info) continue;
      const url: string = info.thumburl || info.url;
      if (!url) continue;
      const mime: string = info.mime || "";
      if (!mime.startsWith("image/") && !url.match(/\.(jpg|jpeg|png|gif|webp|svg)/i)) continue;
      // Skip SVGs (they often don't render well as inline images)
      if (mime === "image/svg+xml") continue;
      const license = info.extmetadata?.LicenseShortName?.value;
      out.push({
        url,
        thumbUrl: url,
        title: page.title?.replace(/^File:/, "") || query,
        source: "Wikimedia Commons",
        width: info.thumbwidth || info.width,
        height: info.thumbheight || info.height,
        license: license ? stripHtml(license) : undefined,
      });
    }
    return out;
  } catch {
    return [];
  }
}

// ---------- Wikipedia article search ----------
// Returns article extracts — a great factual complement to DDG snippets.
export async function searchWikipedia(
  query: string,
  maxResults = 3
): Promise<SearchResult[]> {
  try {
    // Step 1: search for article titles
    const searchUrl =
      `https://en.wikipedia.org/w/api.php?action=query&format=json` +
      `&list=search&srlimit=${maxResults}&srsearch=${encodeURIComponent(query)}`;
    const resp = await fetchWithUA(searchUrl, {}, { bot: true, timeoutMs: 10000 });
    if (!resp.ok) return [];
    const data: any = await resp.json();
    const items: any[] = data?.query?.search || [];
    const out: SearchResult[] = [];
    for (const item of items) {
      const title = item.title;
      const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;
      // Strip HTML from the search snippet
      const snippet = stripHtml(item.snippet || "");
      out.push({ title, url, snippet, source: "Wikipedia" });
    }
    return out;
  } catch {
    return [];
  }
}

// Fetch the full extract of a Wikipedia article by title.
export async function fetchWikipediaExtract(title: string): Promise<string | null> {
  try {
    const url =
      `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=extracts` +
      `&exintro=false&explaintext=true&redirects=1&titles=${encodeURIComponent(title)}`;
    const resp = await fetchWithUA(url, {}, { bot: true, timeoutMs: 10000 });
    if (!resp.ok) return null;
    const data: any = await resp.json();
    const pages = data?.query?.pages;
    if (!pages) return null;
    const page: any = Object.values(pages)[0];
    if (!page || page.missing !== undefined) return null;
    return `=== ${page.title} (Wikipedia) ===\n\n${page.extract || ""}`;
  } catch {
    return null;
  }
}

// ---------- Google News RSS ----------
// No API key required. Returns recent news articles matching the query.
export async function searchGoogleNews(
  query: string,
  maxResults = 6
): Promise<NewsResult[]> {
  try {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
    const resp = await fetchWithUA(url, {}, { bot: true, timeoutMs: 10000 });
    if (!resp.ok) return [];
    const xml = await resp.text();
    const items: NewsResult[] = [];
    const itemRe = /<item>([\s\S]*?)<\/item>/g;
    let m: RegExpExecArray | null;
    while ((m = itemRe.exec(xml)) && items.length < maxResults) {
      const block = m[1];
      const title = block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/)?.[1] || "";
      const link = block.match(/<link>([\s\S]*?)<\/link>/)?.[1]?.trim() || "";
      const desc = block.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/)?.[1] || "";
      const date = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]?.trim();
      const source = block.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] || "Google News";
      const snippet = stripHtml(desc).slice(0, 250);
      if (title && link) {
        items.push({ title: stripHtml(title), url: link, snippet, source, date });
      }
    }
    return items;
  } catch {
    return [];
  }
}

// ---------- Readability-style HTML → main text ----------
// Strips nav/footer/sidebar noise and extracts the main article text.
export function htmlToReadableText(html: string, maxChars = 12000): string {
  // Drop tags we never want
  let cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");

  // Try to extract main content containers (readability heuristic)
  const mainRe = /<(?:main|article)[^>]*>([\s\S]*?)<\/(?:main|article)>/i;
  const mainMatch = cleaned.match(mainRe);
  if (mainMatch) cleaned = mainMatch[1];

  // Convert common block elements to a unique placeholder so they survive
  // the whitespace-collapse step in stripHtml. We use a rare sentinel.
  // \u0001 (SOH) is essentially never in real text.
  const NL = "\u0001";
  cleaned = cleaned
    .replace(/<\/(p|div|section|header|footer|nav|aside|h[1-6]|li|tr|br)>/gi, NL)
    .replace(/<br\s*\/?>/gi, NL)
    .replace(/<li[^>]*>/gi, `${NL}• `)
    .replace(/<h([1-6])[^>]*>/gi, (_, n) => `${NL}${"#".repeat(Number(n))} `);

  // Strip remaining tags (also collapses whitespace — but our NL sentinel is
  // \u0001, NOT whitespace, so it survives).
  cleaned = stripHtml(cleaned);

  // Convert the sentinel back to newlines, then tidy up:
  //  - Strip leading spaces after newlines (from inline tags replaced with " ")
  //  - Collapse multiple newlines before list items to a single newline (tight lists)
  //  - Collapse 3+ newlines to 2 (paragraph breaks)
  cleaned = cleaned
    .replace(/\u0001/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{2,}(•)/g, "\n$1")  // tight lists
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (cleaned.length > maxChars) {
    cleaned = cleaned.slice(0, maxChars) + "\n\n... (truncated)";
  }
  return cleaned;
}
