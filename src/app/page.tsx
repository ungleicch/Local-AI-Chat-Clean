// src/app/page.tsx
"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { AlertCircle, X, PanelRightOpen, PanelRightClose } from "lucide-react";
import { CircularSidebar } from "@/components/chat/circular-sidebar";
import { MessageBubble } from "@/components/chat/message-bubble";
import { MinimalComposer, type Attachment } from "@/components/chat/minimal-composer";
import { SettingsDialog } from "@/components/settings/settings-dialog";
import { FilePanel } from "@/components/chat/file-panel";
import { useChat } from "@/lib/stores/chat";
import { useSettings } from "@/lib/stores/settings";
import type { ChatMessage, StreamChunk, ThinkingEvent, ContentBlock, FileWriteEvent } from "@/lib/types";
import { v4 as uuid } from "uuid";
import { useToast } from "@/hooks/use-toast";
import { useScrollSnapChat } from "@/hooks/use-scroll-snap-chat";
import { motion, AnimatePresence } from "framer-motion";

export default function Home() {
  const { toast } = useToast();
  const {
    conversations,
    currentId,
    messages,
    isStreaming,
    setConversations,
    upsertConversation,
    removeConversation,
    setCurrent,
    setMessages,
    addMessage,
    updateMessage,
    appendToMessage,
    setStreaming,
    addThinkingEvent,
    updateThinkingEvent,
    appendToThinkingEvent,
    setBlocks,
  } = useChat();

  const { providers, models, chat: chatSettings, theme } = useSettings();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [currentProviderId, setCurrentProviderId] = useState<string | undefined>();
  const [currentModelId, setCurrentModelId] = useState<string | undefined>();
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  // File panel state — shown on the right side, displays the conversation's
  // workspace files and auto-opens when the AI writes/edits a file.
  const [filePanelOpen, setFilePanelOpen] = useState(false);
  const [fileWriteEvents, setFileWriteEvents] = useState<FileWriteEvent[]>([]);

  // Mark as mounted after first client render — prevents hydration mismatches
  // for values that differ between server (no providers) and client (loaded from API)
  useEffect(() => {
    setMounted(true);
  }, []);

  // ---------- Theme ----------
  useEffect(() => {
    const apply = () => {
      const isDark =
        theme === "dark" ||
        (theme === "system" &&
          window.matchMedia("(prefers-color-scheme: dark)").matches);
      document.documentElement.classList.toggle("dark", isDark);
    };
    apply();
    if (theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    }
  }, [theme]);

  // ---------- Load providers + conversations on mount ----------
  const loadProviders = useCallback(async () => {
    try {
      const resp = await fetch("/api/providers");
      const data = await resp.json();
      useSettings.getState().setProviders(
        data.providers.map((p: any) => ({
          id: p.id,
          name: p.name,
          type: p.type,
          baseUrl: p.baseUrl,
          apiKey: p.apiKey || undefined,
          enabled: p.enabled,
          isLocal: p.isLocal,
        }))
      );
      useSettings.getState().setModels(
        data.providers.flatMap((p: any) =>
          (p.models || []).map((m: any) => ({
            id: m.id,
            providerId: p.id,
            name: m.name,
            displayName: m.displayName,
            contextWindow: m.contextWindow,
            supportsTools: m.supportsTools,
            supportsVision: m.supportsVision,
          }))
        )
      );
      // Load favorites
      if (data.favorites) {
        useSettings.getState().setFavorites(
          data.favorites.map((f: any) => ({
            modelKey: f.modelKey,
            providerId: f.providerId,
            modelName: f.modelName,
          }))
        );
      }
    } catch (e) {
      // Silent fail on first load
    }
  }, []);

  const loadConversations = useCallback(async () => {
    try {
      const resp = await fetch("/api/conversations");
      const data = await resp.json();
      setConversations(
        data.conversations.map((c: any) => ({
          id: c.id,
          title: c.title,
          pinned: c.pinned,
          updatedAt: c.updatedAt,
        }))
      );
    } catch (e) {
      // ignore
    }
  }, [setConversations]);

  useEffect(() => {
    loadProviders();
    loadConversations();
  }, [loadProviders, loadConversations]);

  // ---------- Auto-select first enabled provider/model ----------
  useEffect(() => {
    if (!currentProviderId || !currentModelId) {
      const firstProvider = providers.find((p) => p.enabled);
      if (firstProvider) {
        const firstModel = models.find(
          (m) => m.providerId === firstProvider.id
        );
        if (firstModel) {
          setCurrentProviderId(firstProvider.id);
          setCurrentModelId(firstModel.id);
        }
      }
    }
  }, [providers, models, currentProviderId, currentModelId]);

  // ---------- Auto-scroll on new messages (smooth) ----------
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, currentId]);

  // ---------- Reset file panel state when conversation changes ----------
  useEffect(() => {
    setFileWriteEvents([]);
  }, [currentId]);

  // ---------- Conversation management ----------
  const handleNewChat = useCallback(async () => {
    try {
      const resp = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "New chat" }),
      });
      const data = await resp.json();
      const conv = data.conversation;
      upsertConversation({
        id: conv.id,
        title: conv.title,
        pinned: conv.pinned,
        updatedAt: conv.updatedAt,
      });
      setCurrent(conv.id);
      setMessages(conv.id, []);
    } catch (e) {
      toast({
        title: "Failed to create conversation",
        description: (e as Error).message,
        variant: "destructive",
      });
    }
  }, [upsertConversation, setCurrent, setMessages, toast]);

  const handleSelect = useCallback(
    async (id: string) => {
      setCurrent(id);
      try {
        const resp = await fetch(`/api/conversations/${id}`);
        const data = await resp.json();
        if (data.conversation?.messages) {
          setMessages(
            id,
            data.conversation.messages.map((m: any) => ({
              id: m.id,
              role: m.role,
              content: m.content,
              toolCalls: m.toolCalls,
              toolCallId: m.toolCallId || undefined,
              toolName: m.toolName || undefined,
              // Restore thinking events (reasoning trace + tool calls) so
              // they survive page reload and chat switching.
              thinking: m.thinking || undefined,
              // Restore ordered content blocks for interleaved rendering.
              blocks: m.blocks || undefined,
              // Restore attachment IDs so file previews survive reload.
              attachments: m.attachments || undefined,
              status: m.status,
              createdAt: m.createdAt,
            }))
          );
        }
      } catch (e) {
        toast({
          title: "Failed to load conversation",
          description: (e as Error).message,
          variant: "destructive",
        });
      }
    },
    [setCurrent, setMessages, toast]
  );

  // ---------- Scroll-snap chat navigation ----------
  // Sort conversations by updatedAt desc (newest first) for navigation
  const sortedConversations = [...conversations].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
  const conversationIds = sortedConversations.map((c) => c.id);

  const handleNavigate = useCallback(
    (id: string) => {
      handleSelect(id);
    },
    [handleSelect]
  );

  useScrollSnapChat({
    conversationIds,
    currentId,
    onNavigate: handleNavigate,
    scrollRef,
  });

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await fetch(`/api/conversations/${id}`, { method: "DELETE" });
        removeConversation(id);
      } catch (e) {
        toast({
          title: "Delete failed",
          description: (e as Error).message,
          variant: "destructive",
        });
      }
    },
    [removeConversation, toast]
  );

  // ---------- Send message + run agent ----------
  const handleSend = useCallback(
    async (text: string, attachmentIds: string[]) => {
      if (!currentProviderId || !currentModelId) {
        toast({
          title: "No model selected",
          description: "Add a provider in Settings first.",
          variant: "destructive",
        });
        setSettingsOpen(true);
        return;
      }

      let convId = currentId;
      if (!convId) {
        try {
          const resp = await fetch("/api/conversations", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: "New chat" }),
          });
          const data = await resp.json();
          convId = data.conversation.id;
          upsertConversation({
            id: convId,
            title: data.conversation.title,
            pinned: false,
            updatedAt: data.conversation.updatedAt,
          });
          setCurrent(convId);
          setMessages(convId, []);
        } catch (e) {
          toast({
            title: "Failed to create conversation",
            description: (e as Error).message,
            variant: "destructive",
          });
          return;
        }
      }

      const conversationId = convId;

      // Add user message locally + persist (with attachment IDs)
      const userMsg: ChatMessage = {
        id: uuid(),
        role: "user",
        content: text,
        status: "complete",
        createdAt: new Date().toISOString(),
        attachments: attachmentIds.length > 0 ? attachmentIds : undefined,
      };
      addMessage(conversationId, userMsg);
      try {
        await fetch(`/api/conversations/${conversationId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            role: "user",
            content: text,
            attachments: attachmentIds.length > 0 ? attachmentIds : undefined,
          }),
        });
      } catch {
        // ignore
      }

      // Generate chat title from the user's first prompt
      const titleText = text.trim().slice(0, 60) + (text.length > 60 ? "…" : "");
      upsertConversation({
        id: conversationId,
        title: titleText,
        pinned: false,
        updatedAt: new Date().toISOString(),
      });
      try {
        await fetch(`/api/conversations/${conversationId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: titleText }),
        });
      } catch {
        // ignore
      }

      // Add placeholder assistant message with thinking state
      const assistantId = uuid();
      const assistantMsg: ChatMessage = {
        id: assistantId,
        role: "assistant",
        content: "",
        status: "streaming",
        createdAt: new Date().toISOString(),
        thinking: [],
        blocks: [],
      };
      addMessage(conversationId, assistantMsg);

      // Open SSE stream
      const controller = new AbortController();
      abortRef.current = controller;
      setStreaming(true);
      setError(null);

      const pendingToolCalls: ChatMessage["toolCalls"] = [];
      // Track active tool call events for status updates
      const activeToolEvents = new Map<string, string>(); // toolCallId -> eventId
      // Stable ID for the streaming thinking event — all thinking chunks
      // for this response append to the same event.
      const thinkingEventId = `thinking-${assistantId}`;
      let thinkingEventCreated = false;
      // Ordered content blocks for interleaved rendering during streaming.
      // Text and tool calls appear in the order they occur.
      const streamBlocks: ContentBlock[] = [];
      let currentTextBlockIdx = -1;
      // Track current thinking block so consecutive thinking chunks merge
      // into one block instead of creating hundreds of tiny blocks.
      let currentThinkingBlockIdx = -1;

      try {
        const resp = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversationId,
            providerId: currentProviderId,
            modelId: currentModelId,
            systemPrompt: chatSettings.defaultSystemPrompt,
            temperature: chatSettings.defaultTemperature,
            maxTokens: chatSettings.defaultMaxTokens,
            maxSteps: chatSettings.maxAgentSteps,
            enabledTools: chatSettings.enabledTools,
            attachments: attachmentIds,
          }),
          signal: controller.signal,
        });

        if (!resp.ok || !resp.body) {
          const errText = await resp.text().catch(() => "Unknown error");
          throw new Error(errText);
        }

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const events = buf.split("\n\n");
          buf = events.pop() || "";
          for (const evt of events) {
            const lines = evt.split("\n");
            let eventType = "message";
            let data = "";
            for (const line of lines) {
              if (line.startsWith("event:")) eventType = line.slice(6).trim();
              else if (line.startsWith("data:")) data = line.slice(5).trim();
            }
            if (!data) continue;
            let payload: StreamChunk;
            try {
              payload = JSON.parse(data);
            } catch {
              continue;
            }
            if (eventType === "text" && payload.content) {
              appendToMessage(conversationId, assistantId, payload.content);
              // Add to stream blocks (merge consecutive text)
              if (currentTextBlockIdx >= 0 && streamBlocks[currentTextBlockIdx].type === "text") {
                streamBlocks[currentTextBlockIdx].content =
                  (streamBlocks[currentTextBlockIdx].content || "") + payload.content;
              } else {
                streamBlocks.push({
                  type: "text",
                  content: payload.content,
                  timestamp: new Date().toISOString(),
                });
                currentTextBlockIdx = streamBlocks.length - 1;
              }
              setBlocks(conversationId, assistantId, [...streamBlocks]);
            } else if (eventType === "thinking" && payload.content) {
              // Reasoning content — append directly to the thinking indicator.
              if (!thinkingEventCreated) {
                addThinkingEvent(conversationId, assistantId, {
                  id: thinkingEventId,
                  type: "thinking",
                  content: payload.content,
                  timestamp: new Date().toISOString(),
                  status: "active",
                });
                thinkingEventCreated = true;
              } else {
                appendToThinkingEvent(conversationId, assistantId, thinkingEventId, payload.content);
              }
              // Merge consecutive thinking chunks into one block (just like text)
              if (currentThinkingBlockIdx >= 0 && streamBlocks[currentThinkingBlockIdx].type === "thinking") {
                streamBlocks[currentThinkingBlockIdx].content =
                  (streamBlocks[currentThinkingBlockIdx].content || "") + payload.content;
              } else {
                streamBlocks.push({
                  type: "thinking",
                  content: payload.content,
                  timestamp: new Date().toISOString(),
                  status: "active",
                });
                currentThinkingBlockIdx = streamBlocks.length - 1;
              }
              currentTextBlockIdx = -1;
              setBlocks(conversationId, assistantId, [...streamBlocks]);
            } else if (eventType === "tool_call" && payload.toolCall) {
              pendingToolCalls?.push(payload.toolCall);
              updateMessage(conversationId, assistantId, {
                toolCalls: [...(pendingToolCalls || [])],
              });
              // Add a thinking event for this tool call
              const eventId = uuid();
              activeToolEvents.set(payload.toolCall.id, eventId);
              const thinkingEvent: ThinkingEvent = {
                id: eventId,
                type: "tool_call",
                toolName: payload.toolCall.name,
                toolArgs: payload.toolCall.arguments,
                timestamp: new Date().toISOString(),
                status: "active",
              };
              addThinkingEvent(conversationId, assistantId, thinkingEvent);
              // Add as a tool_call block (interleaved with text)
              streamBlocks.push({
                type: "tool_call",
                toolCall: payload.toolCall,
                timestamp: new Date().toISOString(),
                status: "active",
              });
              currentTextBlockIdx = -1;
              currentThinkingBlockIdx = -1;
              setBlocks(conversationId, assistantId, [...streamBlocks]);
            } else if (eventType === "tool_result" && payload.toolResult) {
              // Update the corresponding tool_call event to "complete"
              const eventId = activeToolEvents.get(payload.toolResult.toolCallId);
              if (eventId) {
                updateThinkingEvent(conversationId, assistantId, eventId, {
                  status: "complete",
                });
              }
              // Add a tool_result thinking event
              const resultEvent: ThinkingEvent = {
                id: uuid(),
                type: "tool_result",
                toolName: payload.toolResult.name,
                toolResult: payload.toolResult.content,
                timestamp: new Date().toISOString(),
                status: "complete",
              };
              addThinkingEvent(conversationId, assistantId, resultEvent);
              // Add as a tool_result block (interleaved)
              streamBlocks.push({
                type: "tool_result",
                toolResult: payload.toolResult,
                timestamp: new Date().toISOString(),
                status: "complete",
              });
              currentTextBlockIdx = -1;
              currentThinkingBlockIdx = -1;
              setBlocks(conversationId, assistantId, [...streamBlocks]);
            } else if (eventType === "file_write" && payload.fileWrite) {
              // The AI wrote/edited a file. Auto-open the file panel and
              // append the event so the panel updates its tree + shows the
              // live content.
              setFileWriteEvents((prev) => [...prev, payload.fileWrite!]);
              setFilePanelOpen(true);
            } else if (eventType === "error" && payload.error) {
              setError(payload.error);
            } else if (eventType === "done") {
              updateMessage(conversationId, assistantId, { status: "complete" });
            }
          }
        }
        updateMessage(conversationId, assistantId, { status: "complete" });
        loadConversations();
      } catch (e) {
        if ((e as Error).name === "AbortError") {
          updateMessage(conversationId, assistantId, { status: "complete" });
        } else {
          const errMsg = (e as Error).message;
          setError(errMsg);
          updateMessage(conversationId, assistantId, {
            status: "error",
            content:
              (useChat.getState().messages[conversationId]?.find(
                (m) => m.id === assistantId
              )?.content || "") +
              `\n\n⚠️ Error: ${errMsg}`,
          });
        }
      } finally {
        setStreaming(false);
        abortRef.current = null;
      }
    },
    [
      currentId,
      currentProviderId,
      currentModelId,
      chatSettings,
      addMessage,
      appendToMessage,
      updateMessage,
      addThinkingEvent,
      updateThinkingEvent,
      appendToThinkingEvent,
      setBlocks,
      setMessages,
      setCurrent,
      upsertConversation,
      setStreaming,
      toast,
      loadConversations,
    ]
  );

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    setStreaming(false);
  }, [setStreaming]);

  // ---------- Keyboard shortcuts ----------
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey; // Cmd on Mac, Ctrl on Windows/Linux
      if (!mod) return;
      if (e.key === "t" || e.key === "T") {
        e.preventDefault();
        handleNewChat();
      } else if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        handleStop();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [handleNewChat, handleStop]);

  const currentMessages = currentId ? messages[currentId] || [] : [];
  const isLast = (i: number) => i === currentMessages.length - 1;

  return (
    <div className="relative h-screen w-full overflow-hidden bg-background text-foreground">
      {/* Circular hover-reveal sidebar */}
      <CircularSidebar
        conversations={conversations}
        currentId={currentId}
        onSelect={handleSelect}
        onNew={handleNewChat}
        onDelete={handleDelete}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      {/* Main area — flex row: chat column (flex-1) + file panel (fixed width, toggleable) */}
      <main className="flex h-full">
        {/* Chat column — when empty, input bar is vertically centered */}
        <div
          className={
            currentMessages.length === 0
              ? "flex h-full flex-1 flex-col items-center justify-center"
              : "flex h-full flex-1 flex-col"
          }
        >
          {/* Error banner */}
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="mx-auto mt-4 flex max-w-2xl items-center gap-2 rounded-full bg-destructive/10 px-4 py-1.5 text-xs text-destructive"
              >
                <AlertCircle className="h-3 w-3 flex-shrink-0" />
                <span className="flex-1 truncate">{error}</span>
                <button
                  onClick={() => setError(null)}
                  className="hover:bg-destructive/10 rounded-full p-0.5"
                >
                  <X className="h-3 w-3" />
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Messages — always rendered so scrollRef stays attached; empty when no messages */}
          <div ref={scrollRef} className={currentMessages.length === 0 ? "hidden" : "flex-1 overflow-y-auto"}>
            {currentMessages.length > 0 && (
              <div className="mx-auto max-w-3xl py-6">
                {currentMessages.map((m, i) => (
                  <MessageBubble
                    key={m.id}
                    message={m}
                    isStreaming={
                      isStreaming &&
                      isLast(i) &&
                      m.role === "assistant" &&
                      m.status === "streaming"
                    }
                    isLast={isLast(i)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Composer row — composer + file panel toggle button on the right */}
          <div className={currentMessages.length === 0 ? "w-full" : "mt-auto"}>
            <div className="relative">
              <MinimalComposer
                onSend={handleSend}
                onStop={handleStop}
                isStreaming={isStreaming}
                disabled={!mounted || !currentProviderId || !currentModelId}
                providers={providers}
                models={models}
                providerId={currentProviderId}
                modelId={currentModelId}
                onModelChange={(p, m) => {
                  setCurrentProviderId(p);
                  setCurrentModelId(m);
                }}
                attachments={attachments}
                onAttachmentsChange={setAttachments}
                modelPickerOpen={modelPickerOpen}
                onModelPickerOpenChange={setModelPickerOpen}
              />
              {/* File panel toggle — floats at the right edge of the composer area */}
              <button
                onClick={() => setFilePanelOpen(!filePanelOpen)}
                className="absolute right-2 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground transition-colors"
                title={filePanelOpen ? "Hide workspace files" : "Show workspace files"}
              >
                {filePanelOpen ? (
                  <PanelRightClose className="h-4 w-4" />
                ) : (
                  <PanelRightOpen className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>
        </div>

        {/* File panel — right side, shows workspace files + live streaming content */}
        <AnimatePresence>
          {filePanelOpen && (
            <FilePanel
              conversationId={currentId}
              fileWriteEvents={fileWriteEvents}
              isOpen={filePanelOpen}
              onOpenChange={setFilePanelOpen}
            />
          )}
        </AnimatePresence>
      </main>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
