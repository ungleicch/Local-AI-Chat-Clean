// src/components/chat/markdown.tsx
"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import React, { useState, Fragment } from "react";
import { Check, Copy, Brain, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BlockMath, InlineMath } from "react-katex";
import "katex/dist/katex.min.css";
import type { ReactNode } from "react";

interface MarkdownProps {
  content: string;
  className?: string;
}

/**
 * Pre-process raw assistant content:
 *  1. Extract `<think>...</think>` blocks emitted by reasoning models
 *     (DeepSeek-R1, QwQ, Gemma fine-tunes, etc.) so they don't render as
 *     raw text in the markdown body. They are returned separately and
 *     rendered as a collapsible "Reasoning" section above the answer.
 *  2. Also handle an unclosed `<think>` tag (mid-stream snapshot).
 *  3. CRITICAL FIX: if the model wraps its ENTIRE response in `<think>`
 *     tags (common with Gemma fine-tunes served via LM Studio), the main
 *     content would be empty after extraction — leaving a blank message
 *     bubble. We detect this and surface the thinking block's "final
 *     answer" (or the whole block if no marker is found) as the main
 *     content so the user actually sees the response.
 */
function preprocessContent(content: string): {
  content: string;
  thinkingBlocks: string[];
} {
  const thinkingBlocks: string[] = [];

  // Closed <think>...</think> blocks
  const thinkRegex = /<think>([\s\S]*?)<\/think>/gi;
  let cleaned = content.replace(thinkRegex, (_m, inner: string) => {
    const trimmed = inner.trim();
    if (trimmed) thinkingBlocks.push(trimmed);
    return "";
  });

  // Unclosed <think> (streaming) — capture the remainder
  const openThink = cleaned.match(/<think>([\s\S]*)$/i);
  if (openThink) {
    const trimmed = openThink[1].trim();
    if (trimmed) thinkingBlocks.push(trimmed);
    cleaned = cleaned.slice(0, openThink.index);
  }

  // Tidy up leftover blank lines
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();

  // CRITICAL FIX: if the model wrapped its entire response in <think> tags,
  // the main content is now empty and the user would see a blank bubble.
  // Many models (Gemma fine-tunes, DeepSeek-R1, QwQ) put their "final answer"
  // at the end of the thinking block, often after a marker like:
  //   "Final Output:" / "Final Answer:" / "Response:" / "Answer:" / "**Final**"
  // We try to extract that. If no marker is found, we surface the last
  // thinking block as the main content — the model clearly intended it as
  // the answer, so hiding it in a collapsed section would be worse.
  if (!cleaned && thinkingBlocks.length > 0) {
    const lastBlock = thinkingBlocks[thinkingBlocks.length - 1];
    const extracted = extractFinalAnswer(lastBlock);
    if (extracted) {
      // Use the extracted final answer as the main content, keep the full
      // thinking block in the collapsible section for transparency.
      cleaned = extracted;
    } else {
      // No explicit marker — surface the last thinking block as the answer.
      // Remove it from thinkingBlocks so it's not duplicated.
      thinkingBlocks.pop();
      cleaned = lastBlock;
    }
  }

  return { content: cleaned, thinkingBlocks };
}

/**
 * Try to extract a "final answer" from a thinking block. Many reasoning
 * models emit a marker like "Final Output:", "Final Answer:", "Response:",
 * or "Answer:" before the actual answer at the end of their thinking trace.
 * Returns the extracted answer text, or null if no marker is found.
 */
function extractFinalAnswer(block: string): string | null {
  // Common markers used by reasoning models to denote the final answer.
  // Match case-insensitively, allow optional markdown bold (**), and
  // require a colon or newline after the marker word.
  const markers = [
    /\*?\*?Final\s*Output\*?\*?\s*:/i,
    /\*?\*?Final\s*Answer\*?\*?\s*:/i,
    /\*?\*?Final\s*Response\*?\*?\s*:/i,
    /\*?\*?Final\*?\*?\s*:/i,
    /^\s*Response\s*:/im,
    /^\s*Answer\s*:/im,
    /^\s*Output\s*:/im,
  ];
  for (const marker of markers) {
    const match = block.match(marker);
    if (match && match.index !== undefined) {
      const after = block.slice(match.index + match[0].length).trim();
      if (after.length > 0) return after;
    }
  }
  return null;
}

/**
 * Recursively walk React children and replace any string leaf with a
 * `<TextWithMath>` element. This is the reliable way to get inline math
 * (`$...$`) and display math (`$$...$$`) rendering under react-markdown v10,
 * which silently ignores a `text` key in the `components` map.
 *
 * Recurses into nested elements (e.g. <strong> inside <td>) so math inside
 * formatted table cells renders correctly.
 */
function renderChildrenWithMath(children: ReactNode): ReactNode {
  if (typeof children === "string") {
    return <TextWithMath text={children} />;
  }
  if (Array.isArray(children)) {
    return children.map((child, i) => {
      if (typeof child === "string") {
        return <TextWithMath key={i} text={child} />;
      }
      // Recurse into React elements (e.g. <strong>, <em>, <code>)
      if (child && typeof child === "object" && "props" in child) {
        const el = child as React.ReactElement<{ children?: ReactNode }>;
        return React.cloneElement(el, {
          children: renderChildrenWithMath(el.props.children),
        });
      }
      return child;
    });
  }
  // Single React element — recurse into its children
  if (children && typeof children === "object" && "props" in children) {
    const el = children as React.ReactElement<{ children?: ReactNode }>;
    return React.cloneElement(el, {
      children: renderChildrenWithMath(el.props.children),
    });
  }
  return children;
}

export function Markdown({ content, className }: MarkdownProps) {
  const { content: processed, thinkingBlocks } = preprocessContent(content || "");

  return (
    <div className={"markdown-body text-sm leading-relaxed " + (className || "")}>
      {thinkingBlocks.length > 0 && <ThinkingBlocks blocks={thinkingBlocks} />}

      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="text-xl font-semibold mt-4 mb-2 first:mt-0">
              {renderChildrenWithMath(children)}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-lg font-semibold mt-3 mb-2 first:mt-0">
              {renderChildrenWithMath(children)}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-base font-semibold mt-3 mb-1 first:mt-0">
              {renderChildrenWithMath(children)}
            </h3>
          ),
          h4: ({ children }) => (
            <h4 className="text-sm font-semibold mt-2 mb-1 first:mt-0">
              {renderChildrenWithMath(children)}
            </h4>
          ),
          p: ({ children }) => (
            <p className="my-2 first:mt-0 last:mb-0">{renderChildrenWithMath(children)}</p>
          ),
          ul: ({ children }) => (
            <ul className="my-2 ml-5 list-disc space-y-1">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="my-2 ml-5 list-decimal space-y-1">{children}</ol>
          ),
          li: ({ children }) => (
            <li className="leading-relaxed">{renderChildrenWithMath(children)}</li>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-2 border-l-2 border-border pl-3 italic text-muted-foreground">
              {renderChildrenWithMath(children)}
            </blockquote>
          ),
          hr: () => <hr className="my-4 border-border" />,
          a: ({ children, ...props }) => (
            <a
              {...props}
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground underline underline-offset-2 hover:opacity-80"
            >
              {renderChildrenWithMath(children)}
            </a>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold">{renderChildrenWithMath(children)}</strong>
          ),
          em: ({ children }) => <em>{renderChildrenWithMath(children)}</em>,
          // Tables — minimal, clean design
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto rounded-lg border border-border/50">
              <table className="w-full border-collapse text-xs">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-foreground/[0.06]">{children}</thead>,
          th: ({ children }) => (
            <th className="border-b border-border/50 px-3 py-2 text-left font-semibold text-foreground">
              {renderChildrenWithMath(children)}
            </th>
          ),
          tbody: ({ children }) => <tbody>{children}</tbody>,
          tr: ({ children }) => (
            <tr className="border-b border-border/30 last:border-0 hover:bg-foreground/[0.02] transition-colors">
              {children}
            </tr>
          ),
          td: ({ children }) => (
            <td className="px-3 py-2 text-foreground/80">
              {renderChildrenWithMath(children)}
            </td>
          ),
          // Images — for AI-generated and uploaded images.
          // IMPORTANT: react-markdown wraps inline images in <p> tags, and
          // <p> can only contain phrasing (inline) content. <figure> and
          // <figcaption> are flow (block) elements and CANNOT be nested
          // inside <p> — doing so causes a React hydration error.
          // We use <span> with display:block via Tailwind classes instead.
          // <span> is phrasing content, so it's valid inside <p>.
          img: ({ src, alt }) => {
            // --- Special embed syntax ---
            // The embed_youtube / embed_video / embed_audio / embed_link_preview
            // tools emit markdown in the form:
            //   ![video](youtube:ID "title")
            //   ![video](video:URL "title")
            //   ![audio](audio:URL "title")
            //   ![preview](preview:URL "title|desc|imageURL")
            // We detect the prefix and render the appropriate element.
            const srcStr = String(src || "");
            const altStr = String(alt || "");

            if (srcStr.startsWith("youtube:")) {
              const idAndQuery = srcStr.slice("youtube:".length);
              // The title attribute (alt) carries the display title.
              // idAndQuery may include &start=SECONDS for deep-linking.
              const videoId = idAndQuery.split(/[&?]/)[0];
              const startMatch = idAndQuery.match(/start=(\d+)/);
              const start = startMatch ? Number(startMatch[1]) : 0;
              return (
                <span className="my-3 block">
                  <YouTubeEmbed videoId={videoId} title={altStr} start={start} />
                  {altStr && (
                    <span className="mt-1.5 block text-xs text-muted-foreground text-center">
                      {altStr}
                    </span>
                  )}
                </span>
              );
            }

            if (srcStr.startsWith("video:")) {
              const url = srcStr.slice("video:".length);
              return (
                <span className="my-3 block">
                  <video
                    src={url}
                    controls
                    className="rounded-lg max-w-full h-auto border border-border/30"
                  />
                  {altStr && (
                    <span className="mt-1.5 block text-xs text-muted-foreground text-center">
                      {altStr}
                    </span>
                  )}
                </span>
              );
            }

            if (srcStr.startsWith("audio:")) {
              const url = srcStr.slice("audio:".length);
              return (
                <span className="my-3 block">
                  <audio src={url} controls className="w-full" />
                  {altStr && (
                    <span className="mt-1.5 block text-xs text-muted-foreground text-center">
                      {altStr}
                    </span>
                  )}
                </span>
              );
            }

            if (srcStr.startsWith("preview:")) {
              const url = srcStr.slice("preview:".length);
              // alt carries "title|description|imageURL"
              const parts = altStr.split("|");
              const title = parts[0]?.trim() || url;
              const desc = parts[1]?.trim() || "";
              const image = parts[2]?.trim() || "";
              return <LinkPreviewCard url={url} title={title} description={desc} image={image} />;
            }

            // --- Standard image ---
            return (
              <span className="my-3 block">
                <img
                  src={src}
                  alt={alt || ""}
                  className="rounded-lg max-w-full h-auto border border-border/30"
                  loading="lazy"
                />
                {alt && (
                  <span className="mt-1.5 block text-xs text-muted-foreground text-center">
                    {alt}
                  </span>
                )}
              </span>
            );
          },
          // Code blocks
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || "");
            const inline = !match && !String(children).includes("\n");
            if (inline) {
              return (
                <code
                  className="rounded bg-foreground/[0.08] px-1.5 py-0.5 font-mono text-[0.85em] text-foreground/90"
                  {...props}
                >
                  {children}
                </code>
              );
            }
            return (
              <CodeBlock
                language={match ? match[1] : "text"}
                value={String(children).replace(/\n$/, "")}
              />
            );
          },
          pre({ children }) {
            return <>{children}</>;
          },
        }}
      >
        {processed}
      </ReactMarkdown>
    </div>
  );
}

/**
 * Collapsible reasoning trace extracted from `<think>...</think>` blocks.
 * Rendered above the main answer, collapsed by default to keep the UI clean.
 */
function ThinkingBlocks({ blocks }: { blocks: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="my-2 rounded-lg border border-border/40 bg-foreground/[0.02]">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground hover:bg-foreground/[0.03] transition-colors"
      >
        <Brain className="h-3.5 w-3.5" />
        <span>Reasoning trace</span>
        <span className="text-muted-foreground/60">({blocks.length} block{blocks.length > 1 ? "s" : ""})</span>
        <span className="ml-auto">
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </span>
      </button>
      {open && (
        <div className="space-y-2 px-3 pb-3 pt-1 text-xs leading-relaxed text-muted-foreground/80 whitespace-pre-wrap">
          {blocks.map((b, i) => (
            <Fragment key={i}>
              {i > 0 && <hr className="border-border/30" />}
              <div>{b}</div>
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
}

// Component to render text with inline math ($...$) and display math ($$...$$)
function TextWithMath({ text }: { text: string }) {
  const parts = parseMathSegments(text);
  return (
    <>
      {parts.map((part, i) => {
        if (part.type === "display") {
          try {
            return <BlockMath key={i} math={part.content} />;
          } catch {
            return <code key={i} className="text-muted-foreground">$$ {part.content} $$</code>;
          }
        }
        if (part.type === "inline") {
          try {
            return <InlineMath key={i} math={part.content} />;
          } catch {
            return <code key={i} className="text-muted-foreground">${part.content}$</code>;
          }
        }
        return <span key={i}>{part.content}</span>;
      })}
    </>
  );
}

// Parse text into segments: regular text, inline math ($...$), display math ($$...$$)
// Allows escaped dollar signs (\$) inside math expressions.
function parseMathSegments(text: string): Array<{ type: "text" | "inline" | "display"; content: string }> {
  const segments: Array<{ type: "text" | "inline" | "display"; content: string }> = [];
  let remaining = text;

  // $$ ... $$ (display) — allow non-greedy any chars including escaped $
  // $ ... $  (inline)  — single line, no newline
  const displayRe = /\$\$([\s\S]+?)\$\$/;
  const inlineRe = /\$([^\n$]+?)\$/;

  while (remaining.length > 0) {
    const displayMatch = remaining.match(displayRe);
    const inlineMatch = remaining.match(inlineRe);

    const displayIdx = displayMatch?.index ?? Infinity;
    const inlineIdx = inlineMatch?.index ?? Infinity;

    if (displayMatch && displayIdx <= inlineIdx) {
      if (displayIdx > 0) {
        segments.push({ type: "text", content: remaining.slice(0, displayIdx) });
      }
      segments.push({ type: "display", content: displayMatch[1] });
      remaining = remaining.slice(displayIdx + displayMatch[0].length);
    } else if (inlineMatch) {
      if (inlineIdx > 0) {
        segments.push({ type: "text", content: remaining.slice(0, inlineIdx) });
      }
      segments.push({ type: "inline", content: inlineMatch[1] });
      remaining = remaining.slice(inlineIdx + inlineMatch[0].length);
    } else {
      segments.push({ type: "text", content: remaining });
      break;
    }
  }

  return segments;
}

function CodeBlock({
  language,
  value,
}: {
  language: string;
  value: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <div className="group relative my-3 overflow-hidden rounded-lg border border-border/40 bg-[#1a1a2e]">
      <div className="flex items-center justify-between border-b border-white/5 px-3 py-1.5">
        <span className="text-xs font-mono text-zinc-400">{language}</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={copy}
          className="h-6 px-2 text-xs text-zinc-400 hover:text-zinc-100"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 mr-1" /> Copied
            </>
          ) : (
            <>
              <Copy className="h-3 w-3 mr-1" /> Copy
            </>
          )}
        </Button>
      </div>
      <SyntaxHighlighter
        language={language}
        style={oneDark}
        customStyle={{
          margin: 0,
          background: "transparent",
          padding: "0.75rem",
          fontSize: "0.8rem",
        }}
        wrapLongLines
      >
        {value}
      </SyntaxHighlighter>
    </div>
  );
}

/**
 * Responsive YouTube iframe embed.
 * Uses a 16:9 aspect-ratio wrapper so the player scales fluidly with the
 * chat column width. Loads lazily and enables the JS API for deep-linking.
 */
function YouTubeEmbed({
  videoId,
  title,
  start = 0,
}: {
  videoId: string;
  title: string;
  start?: number;
}) {
  const src = `https://www.youtube-nocookie.com/embed/${videoId}?rel=0${
    start > 0 ? `&start=${start}` : ""
  }`;
  return (
    <div className="relative w-full overflow-hidden rounded-lg border border-border/30 bg-black" style={{ aspectRatio: "16 / 9" }}>
      <iframe
        src={src}
        title={title || "YouTube video"}
        loading="lazy"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
        className="absolute inset-0 h-full w-full"
      />
    </div>
  );
}

/**
 * Rich link preview card. Shows an OG image (if any), title, description,
 * and a clickable link to the URL.
 */
function LinkPreviewCard({
  url,
  title,
  description,
  image,
}: {
  url: string;
  title: string;
  description: string;
  image: string;
}) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="my-3 flex flex-col sm:flex-row overflow-hidden rounded-lg border border-border/40 bg-card hover:bg-foreground/[0.02] transition-colors group"
    >
      {image && (
        <div className="sm:w-40 h-32 sm:h-auto flex-shrink-0 bg-foreground/[0.04] overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image}
            alt={title}
            className="h-full w-full object-cover"
            loading="lazy"
            onError={(e) => {
              (e.currentTarget.parentElement as HTMLElement).style.display = "none";
            }}
          />
        </div>
      )}
      <div className="flex flex-1 flex-col gap-1 p-3 min-w-0">
        <span className="text-sm font-medium text-foreground line-clamp-2 group-hover:underline">
          {title}
        </span>
        {description && (
          <span className="text-xs text-muted-foreground line-clamp-2">
            {description}
          </span>
        )}
        <span className="mt-auto text-[0.7rem] text-muted-foreground/60 truncate">
          {url.replace(/^https?:\/\//, "").replace(/\/$/, "")}
        </span>
      </div>
    </a>
  );
}
