// src/lib/citations.ts
// Citation parsing utilities.
//
// The AI emits source citations inline using a compact marker syntax:
//
//   [source:URL]
//   [source:URL|label]
//   [source:URL|label|title]
//
// These markers are stripped from the visible text and collected into a list
// of citation objects. The frontend renders them as small (i) link chips
// appended to the end of the text block where they appeared.
//
// Multiple citations can appear in a single text block. They can be placed
// anywhere — typically right after the claim they support.
//
// The marker is deliberately designed to be:
//   - Easy for the AI to emit (no markdown learning required)
//   - Unambiguous (the [source: prefix is unlikely to appear in normal text)
//   - Lenient about URL format (http, https, bare domains all accepted)
//   - Optional label / title (pipe-separated)
//
// Examples:
//   The Eiffel Tower is 330m tall[source:https://en.wikipedia.org/wiki/Eiffel_Tower].
//   → text: "The Eiffel Tower is 330m tall."
//     citations: [{ url, label: "en.wikipedia.org" }]
//
//   Python was created in 1991[source:https://python.org|Python].
//   → text: "Python was created in 1991."
//     citations: [{ url, label: "Python" }]

export interface Citation {
  url: string;
  label: string; // short display label (hostname or custom)
  title?: string; // optional longer title (for tooltip)
}

export interface ParsedText {
  text: string; // text with citation markers stripped
  citations: Citation[]; // citations in order of appearance
}

// Match [source:URL] or [source:URL|label] or [source:URL|label|title]
// URL must start with http:// or https:// — bare domains are NOT auto-linked
// (avoids false positives on text like "[source:example.com]").
//
// We allow URLs with most characters except ] and | (which are delimiters).
const CITATION_RE = /\[source:(https?:\/\/[^\]|]+)(?:\|([^\]|]+))?(?:\|([^\]]+))?\]/g;

/**
 * Parse a text block, extracting all [source:URL] citations.
 * Returns the cleaned text (markers removed) and the list of citations.
 *
 * Citations are deduplicated by URL (keeping the first occurrence's label).
 */
export function parseCitations(input: string): ParsedText {
  const citations: Citation[] = [];
  const seen = new Set<string>();

  const text = input.replace(CITATION_RE, (full, url: string, label?: string, title?: string) => {
    const cleanUrl = url.trim();
    if (!cleanUrl) return "";

    if (seen.has(cleanUrl)) {
      // Already cited — drop the marker entirely (no duplicate chip)
      return "";
    }
    seen.add(cleanUrl);

    // Derive a short label if none was provided
    let displayLabel = (label || "").trim();
    if (!displayLabel) {
      try {
        const u = new URL(cleanUrl);
        // Use the hostname without "www." prefix, plus a hint of the path
        // so multiple sources from the same site are distinguishable.
        const host = u.hostname.replace(/^www\./, "");
        displayLabel = host;
      } catch {
        displayLabel = "source";
      }
    }

    citations.push({
      url: cleanUrl,
      label: displayLabel,
      title: (title || "").trim() || undefined,
    });
    return "";
  });

  // Clean up trailing whitespace left by removed markers (e.g. "text . " → "text.")
  // But preserve the position of the marker — we just remove the [source:...]
  // token itself. A space before the marker is left as-is so "tall[source:...]"
  // becomes "tall" (no space) and "tall [source:...]" becomes "tall " (space).
  // We do a light tidy: collapse double spaces that may result.
  const cleaned = text.replace(/  +/g, " ").replace(/\s+\./g, ".").replace(/\s+,/g, ",");

  return { text: cleaned, citations };
}

/**
 * Parse a text block AND split it into segments so we can render citations
 * at the END of each paragraph (rather than all at the end of the block).
 *
 * Returns an array of paragraphs, each with its own text + citations.
 */
export interface ParagraphWithCitations {
  text: string;
  citations: Citation[];
}

export function parseCitationsByParagraph(input: string): ParagraphWithCitations[] {
  // Split on double newlines (markdown paragraph breaks).
  // Single newlines within a paragraph are preserved (they may be soft breaks).
  const rawParagraphs = input.split(/\n{2,}/);
  const out: ParagraphWithCitations[] = [];

  // Track citations we've already shown globally so we don't repeat the same
  // source chip in every paragraph if the AI cited it repeatedly.
  const globalSeen = new Set<string>();

  for (const raw of rawParagraphs) {
    if (!raw.trim()) continue;
    const parsed = parseCitations(raw);
    // Filter out citations we've already shown in a previous paragraph
    const newCitations = parsed.citations.filter((c) => {
      if (globalSeen.has(c.url)) return false;
      globalSeen.add(c.url);
      return true;
    });
    out.push({ text: parsed.text, citations: newCitations });
  }

  // If the entire input had no paragraph breaks, still return one paragraph
  if (out.length === 0) {
    out.push({ text: input, citations: [] });
  }

  return out;
}
