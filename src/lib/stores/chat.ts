"use client";

import { create } from "zustand";
import type { ChatMessage, ThinkingEvent } from "@/lib/types";

interface Conversation {
  id: string;
  title: string;
  providerId?: string;
  modelId?: string;
  systemPrompt?: string;
  pinned: boolean;
  updatedAt: string;
}

interface ChatState {
  conversations: Conversation[];
  currentId: string | null;
  messages: Record<string, ChatMessage[]>;
  isStreaming: boolean;
  // Track which assistant message's thinking panel is expanded
  expandedThinking: Record<string, boolean>;
  // Setters
  setConversations: (c: Conversation[]) => void;
  upsertConversation: (c: Conversation) => void;
  removeConversation: (id: string) => void;
  setCurrent: (id: string | null) => void;
  setMessages: (convId: string, msgs: ChatMessage[]) => void;
  addMessage: (convId: string, msg: ChatMessage) => void;
  updateMessage: (convId: string, msgId: string, patch: Partial<ChatMessage>) => void;
  appendToMessage: (convId: string, msgId: string, text: string) => void;
  clearMessages: (convId: string) => void;
  setStreaming: (s: boolean) => void;
  addThinkingEvent: (convId: string, msgId: string, event: ThinkingEvent) => void;
  updateThinkingEvent: (convId: string, msgId: string, eventId: string, patch: Partial<ThinkingEvent>) => void;
  toggleThinking: (msgId: string) => void;
}

export const useChat = create<ChatState>()((set) => ({
  conversations: [],
  currentId: null,
  messages: {},
  isStreaming: false,
  expandedThinking: {},
  setConversations: (conversations) => set({ conversations }),
  upsertConversation: (c) =>
    set((s) => {
      const existing = s.conversations.find((x) => x.id === c.id);
      const conversations = existing
        ? s.conversations.map((x) => (x.id === c.id ? { ...x, ...c } : x))
        : [c, ...s.conversations];
      return { conversations };
    }),
  removeConversation: (id) =>
    set((s) => ({
      conversations: s.conversations.filter((c) => c.id !== id),
      currentId: s.currentId === id ? null : s.currentId,
      messages: Object.fromEntries(
        Object.entries(s.messages).filter(([k]) => k !== id)
      ),
    })),
  setCurrent: (currentId) => set({ currentId }),
  setMessages: (convId, msgs) =>
    set((s) => ({ messages: { ...s.messages, [convId]: msgs } })),
  addMessage: (convId, msg) =>
    set((s) => ({
      messages: {
        ...s.messages,
        [convId]: [...(s.messages[convId] || []), msg],
      },
    })),
  updateMessage: (convId, msgId, patch) =>
    set((s) => ({
      messages: {
        ...s.messages,
        [convId]: (s.messages[convId] || []).map((m) =>
          m.id === msgId ? { ...m, ...patch } : m
        ),
      },
    })),
  appendToMessage: (convId, msgId, text) =>
    set((s) => ({
      messages: {
        ...s.messages,
        [convId]: (s.messages[convId] || []).map((m) =>
          m.id === msgId ? { ...m, content: m.content + text } : m
        ),
      },
    })),
  clearMessages: (convId) =>
    set((s) => ({
      messages: { ...s.messages, [convId]: [] },
    })),
  setStreaming: (isStreaming) => set({ isStreaming }),
  addThinkingEvent: (convId, msgId, event) =>
    set((s) => ({
      messages: {
        ...s.messages,
        [convId]: (s.messages[convId] || []).map((m) =>
          m.id === msgId
            ? { ...m, thinking: [...(m.thinking || []), event] }
            : m
        ),
      },
    })),
  updateThinkingEvent: (convId, msgId, eventId, patch) =>
    set((s) => ({
      messages: {
        ...s.messages,
        [convId]: (s.messages[convId] || []).map((m) =>
          m.id === msgId
            ? {
                ...m,
                thinking: (m.thinking || []).map((e) =>
                  e.id === eventId ? { ...e, ...patch } : e
                ),
              }
            : m
        ),
      },
    })),
  toggleThinking: (msgId) =>
    set((s) => ({
      expandedThinking: {
        ...s.expandedThinking,
        [msgId]: !s.expandedThinking[msgId],
      },
    })),
}));
