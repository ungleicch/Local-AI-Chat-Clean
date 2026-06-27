"use client";

import { useState, useRef, useEffect } from "react";
import { Paperclip, X, FileText, Square } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { T3ModelPicker } from "./t3-model-picker";
import type { ProviderConfig, ModelConfig } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface Attachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
}

interface MinimalComposerProps {
  onSend: (text: string, attachmentIds: string[]) => void;
  onStop: () => void;
  isStreaming: boolean;
  disabled?: boolean;
  providers: ProviderConfig[];
  models: ModelConfig[];
  providerId?: string;
  modelId?: string;
  onModelChange: (providerId: string, modelId: string) => void;
  attachments: Attachment[];
  onAttachmentsChange: (attachments: Attachment[]) => void;
  modelPickerOpen: boolean;
  onModelPickerOpenChange: (open: boolean) => void;
}

export function MinimalComposer({
  onSend,
  onStop,
  isStreaming,
  disabled,
  providers,
  models,
  providerId,
  modelId,
  onModelChange,
  attachments,
  onAttachmentsChange,
  modelPickerOpen,
  onModelPickerOpenChange,
}: MinimalComposerProps) {
  const [text, setText] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [toolsHovered, setToolsHovered] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const hasText = text.trim().length > 0;

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
  }, [text]);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed || disabled || isStreaming) return;
    onSend(trimmed, attachments.map((a) => a.id));
    setText("");
    onAttachmentsChange([]);
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files);
    if (arr.length === 0) return;
    const formData = new FormData();
    arr.forEach((f) => formData.append("files", f));
    try {
      const resp = await fetch("/api/upload", { method: "POST", body: formData });
      const data = await resp.json();
      if (data.files) {
        onAttachmentsChange([
          ...attachments,
          ...data.files.map((f: Attachment) => ({
            id: f.id, filename: f.filename, mimeType: f.mimeType, size: f.size,
          })),
        ]);
      }
    } catch (e) {
      console.error("Upload failed:", e);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
  };

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); };
  const removeAttachment = (id: string) => onAttachmentsChange(attachments.filter((a) => a.id !== id));

  const toolsVisible = toolsHovered && !hasText && !isFocused;

  return (
    <div className="px-4 pb-6 pt-2">
      <div className="mx-auto max-w-3xl">
        {/* When streaming: hide input bar entirely, show only stop button on the right */}
        <AnimatePresence mode="wait">
          {isStreaming ? (
            /* Streaming state — just a stop button, right-aligned */
            <motion.div
              key="streaming"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="flex justify-end"
            >
              <motion.button
                initial={{ scale: 0.8 }}
                animate={{ scale: 1 }}
                onClick={onStop}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-foreground text-background hover:opacity-80 transition-opacity"
                title="Stop (⌘S)"
              >
                <Square className="h-3.5 w-3.5" fill="currentColor" />
              </motion.button>
            </motion.div>
          ) : (
            /* Normal state — tools on left, chips + input bar stacked on the right */
            <motion.div
              key="input"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="flex items-end gap-1.5"
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
            >
              {/* Tools area — outside the input bar, invisible until hover */}
              <div
                className="flex items-center gap-0.5 flex-shrink-0 pb-1"
                onMouseEnter={() => setToolsHovered(true)}
                onMouseLeave={() => setToolsHovered(false)}
              >
                <div>
                  <T3ModelPicker
                    providers={providers}
                    models={models}
                    providerId={providerId}
                    modelId={modelId}
                    onChange={onModelChange}
                    open={modelPickerOpen}
                    onOpenChange={onModelPickerOpenChange}
                    toolsHovered={toolsVisible}
                  />
                </div>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex h-10 w-10 items-center justify-center rounded-full flex-shrink-0 transition-all duration-200"
                  title="Attach files"
                >
                  <Paperclip className={cn("h-[22px] w-[22px] transition-opacity duration-200", toolsVisible ? "opacity-40 hover:!opacity-100" : "opacity-0")} />
                </button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) handleFiles(e.target.files);
                  e.target.value = "";
                }}
              />

              {/* Right column: attachment chips above the input bar */}
              <div className="flex flex-col flex-1 min-w-0">
                {/* Attachment chips — only above the input bar */}
                <AnimatePresence>
                  {attachments.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="flex flex-wrap gap-1.5 mb-2 pl-1"
                    >
                      {attachments.map((a) => (
                        <div key={a.id} className="group relative h-12 w-12 overflow-hidden rounded-lg bg-foreground/[0.06] flex-shrink-0">
                          {a.mimeType.startsWith("image/") ? (
                            <img
                              src={`/api/files/${a.id}`}
                              alt={a.filename}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center">
                              <FileText className="h-4 w-4 text-muted-foreground" />
                            </div>
                          )}
                          {/* Remove button — appears on hover */}
                          <button
                            onClick={() => removeAttachment(a.id)}
                            className="absolute top-0.5 right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-background/80 backdrop-blur-sm text-foreground opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive hover:text-destructive-foreground"
                            title="Remove"
                          >
                            <X className="h-2.5 w-2.5" />
                          </button>
                        </div>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Input bar container — min-h-[60px], fully rounded sides */}
                <motion.div
                  animate={{ scale: isFocused ? 1.005 : 1 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                  className={cn(
                    "relative rounded-full border transition-all duration-300",
                    "bg-card border-border",
                    isFocused && "shadow-lg shadow-black/40",
                    isDragging && "ring-2 ring-foreground/20"
                  )}
                >
                  {/* Text area — min-h-[60px], grows up to 400px */}
                  <div className="relative min-h-[60px]">
                    <textarea
                      ref={textareaRef}
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      onKeyDown={handleKey}
                      onFocus={() => setIsFocused(true)}
                      onBlur={() => setIsFocused(false)}
                      placeholder=""
                      disabled={Boolean(disabled)}
                      suppressHydrationWarning
                      rows={1}
                      className={cn(
                        "w-full resize-none border-0 bg-transparent px-6 pt-4 pb-2 text-sm leading-relaxed text-foreground",
                        "placeholder:text-transparent",
                        "focus:outline-none disabled:cursor-not-allowed",
                        "max-h-[400px] overflow-y-auto scroll-smooth"
                      )}
                    />
                  </div>
                </motion.div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
