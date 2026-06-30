// src/components/chat/citations.tsx
"use client";

import { Info } from "lucide-react";
import type { Citation } from "@/lib/citations";

/**
 * A row of citation chips rendered at the end of a text block.
 * Each chip shows a small (i) icon and the source label, linking to the URL.
 *
 * The chips are styled to be unobtrusive — small, muted, with hover affordance.
 * Clicking opens the source URL in a new tab.
 */
export function Citations({ citations }: { citations: Citation[] }) {
  if (!citations || citations.length === 0) return null;

  return (
    <span className="inline-flex flex-wrap items-center gap-1 ml-1 align-middle">
      {citations.map((c, i) => (
        <a
          key={i}
          href={c.url}
          target="_blank"
          rel="noopener noreferrer"
          title={c.title || c.url}
          className="inline-flex items-center gap-0.5 rounded-full bg-foreground/[0.06] hover:bg-foreground/[0.12] px-1.5 py-0.5 text-[0.65rem] text-muted-foreground hover:text-foreground transition-colors no-underline"
        >
          <Info className="h-2.5 w-2.5" />
          <span className="font-mono truncate max-w-[12rem]">{c.label}</span>
        </a>
      ))}
    </span>
  );
}
