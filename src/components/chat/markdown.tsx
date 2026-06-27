"use client";

import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { useState, createElement } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BlockMath, InlineMath } from "react-katex";
import "katex/dist/katex.min.css";

interface MarkdownProps {
  content: string;
  className?: string;
}

export function Markdown({ content, className }: MarkdownProps) {
  // Pre-process content to extract LaTeX blocks ($$...$$ and $...$)
  const processed = content;

  return (
    <div className={"markdown-body text-sm leading-relaxed " + (className || "")}>
      <ReactMarkdown
        components={{
          h1: ({ children }) => (
            <h1 className="text-xl font-semibold mt-4 mb-2 first:mt-0">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-lg font-semibold mt-3 mb-2 first:mt-0">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-base font-semibold mt-3 mb-1 first:mt-0">{children}</h3>
          ),
          h4: ({ children }) => (
            <h4 className="text-sm font-semibold mt-2 mb-1 first:mt-0">{children}</h4>
          ),
          p: ({ children }) => (
            <p className="my-2 first:mt-0 last:mb-0">{children}</p>
          ),
          ul: ({ children }) => (
            <ul className="my-2 ml-5 list-disc space-y-1">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="my-2 ml-5 list-decimal space-y-1">{children}</ol>
          ),
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="my-2 border-l-2 border-border pl-3 italic text-muted-foreground">
              {children}
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
              {children}
            </a>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold">{children}</strong>
          ),
          em: ({ children }) => <em>{children}</em>,
          // Tables — minimal, clean design
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto rounded-lg border border-border/50">
              <table className="w-full border-collapse text-xs">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-foreground/[0.06]">{children}</thead>,
          th: ({ children }) => (
            <th className="border-b border-border/50 px-3 py-2 text-left font-semibold text-foreground">
              {children}
            </th>
          ),
          tbody: ({ children }) => <tbody>{children}</tbody>,
          tr: ({ children }) => (
            <tr className="border-b border-border/30 last:border-0 hover:bg-foreground/[0.02] transition-colors">
              {children}
            </tr>
          ),
          td: ({ children }) => (
            <td className="px-3 py-2 text-foreground/80">{children}</td>
          ),
          // Images — for AI-generated and uploaded images
          img: ({ src, alt }) => (
            <figure className="my-3">
              <img
                src={src}
                alt={alt || ""}
                className="rounded-lg max-w-full h-auto border border-border/30"
                loading="lazy"
              />
              {alt && (
                <figcaption className="mt-1.5 text-xs text-muted-foreground text-center">
                  {alt}
                </figcaption>
              )}
            </figure>
          ),
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
          // Custom handling for math — we process it in the text renderer
          text: ({ children }) => {
            if (typeof children !== "string") return <>{children}</>;
            return <TextWithMath text={children} />;
          },
        }}
      >
        {processed}
      </ReactMarkdown>
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
function parseMathSegments(text: string): Array<{ type: "text" | "inline" | "display"; content: string }> {
  const segments: Array<{ type: "text" | "inline" | "display"; content: string }> = [];
  let remaining = text;

  while (remaining.length > 0) {
    // Look for $$...$$ (display math) first
    const displayMatch = remaining.match(/\$\$([^$]+)\$\$/);
    // Look for $...$ (inline math)
    const inlineMatch = remaining.match(/\$([^$\n]+)\$/);

    if (displayMatch && displayMatch.index !== undefined && (!inlineMatch || displayMatch.index <= (inlineMatch.index || 0))) {
      // Text before $$
      if (displayMatch.index > 0) {
        segments.push({ type: "text", content: remaining.slice(0, displayMatch.index) });
      }
      segments.push({ type: "display", content: displayMatch[1] });
      remaining = remaining.slice(displayMatch.index + displayMatch[0].length);
    } else if (inlineMatch && inlineMatch.index !== undefined) {
      // Text before $
      if (inlineMatch.index > 0) {
        segments.push({ type: "text", content: remaining.slice(0, inlineMatch.index) });
      }
      segments.push({ type: "inline", content: inlineMatch[1] });
      remaining = remaining.slice(inlineMatch.index + inlineMatch[0].length);
    } else {
      // No more math, push remaining text
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
