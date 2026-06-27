"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Square, Loader2, Paperclip, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface ComposerProps {
  onSend: (text: string) => void;
  onStop: () => void;
  isStreaming: boolean;
  disabled?: boolean;
  placeholder?: string;
  onOpenSettings?: () => void;
}

export function Composer({
  onSend,
  onStop,
  isStreaming,
  disabled,
  placeholder,
  onOpenSettings,
}: ComposerProps) {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 240) + "px";
  }, [text]);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed || disabled || isStreaming) return;
    onSend(trimmed);
    setText("");
  };

  const handleKey = (e: React.KeyboardEvent) => {
    // IME composition guard — see minimal-composer.tsx for rationale.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto max-w-3xl px-4 py-3">
        <div className="relative flex items-end gap-2 rounded-2xl border border-border bg-muted/40 px-2 py-2 focus-within:border-foreground/30 focus-within:bg-background transition-colors">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 flex-shrink-0 text-muted-foreground"
            onClick={onOpenSettings}
            title="Settings"
          >
            <Settings2 className="h-4 w-4" />
          </Button>
          <Textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKey}
            placeholder={placeholder || "Message your AI assistant…"}
            disabled={disabled}
            rows={1}
            className={cn(
              "min-h-[36px] flex-1 resize-none border-0 bg-transparent px-1 py-1.5 text-sm shadow-none focus-visible:ring-0 focus-visible:ring-offset-0",
              "placeholder:text-muted-foreground/60"
            )}
          />
          {isStreaming ? (
            <Button
              size="icon"
              onClick={onStop}
              className="h-8 w-8 flex-shrink-0 rounded-full"
              variant="destructive"
              title="Stop"
            >
              <Square className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <Button
              size="icon"
              onClick={handleSend}
              disabled={disabled || !text.trim()}
              className="h-8 w-8 flex-shrink-0 rounded-full"
              title="Send"
            >
              {disabled ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
            </Button>
          )}
        </div>
        <div className="mt-1.5 flex items-center justify-between px-1 text-[0.7rem] text-muted-foreground/70">
          <span>
            <kbd className="font-mono">Enter</kbd> to send,{" "}
            <kbd className="font-mono">Shift+Enter</kbd> for new line
          </span>
          <span className="hidden sm:block">
            Agent mode with tools enabled
          </span>
        </div>
      </div>
    </div>
  );
}
