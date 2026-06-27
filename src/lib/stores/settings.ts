"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ProviderConfig, ModelConfig } from "@/lib/types";

export type ThemeMode = "light" | "dark" | "system";

export interface UITheme {
  accent: string;
  density: "comfortable" | "compact";
}

export interface ChatSettings {
  defaultTemperature: number;
  defaultMaxTokens: number;
  maxAgentSteps: number;
  enabledTools: string[];
  defaultSystemPrompt: string;
  thinkingMode: ThinkingMode;
}

export type ThinkingMode = "off" | "low" | "medium" | "high";

export interface FavoriteModel {
  modelKey: string; // "providerId:modelName"
  providerId: string;
  modelName: string;
}

interface SettingsState {
  providers: ProviderConfig[];
  models: ModelConfig[];
  favorites: FavoriteModel[];
  ui: UITheme;
  chat: ChatSettings;
  theme: ThemeMode;
  setProviders: (p: ProviderConfig[]) => void;
  setModels: (m: ModelConfig[]) => void;
  setFavorites: (f: FavoriteModel[]) => void;
  toggleFavorite: (providerId: string, modelName: string) => void;
  isFavorite: (providerId: string, modelName: string) => boolean;
  setUi: (u: Partial<UITheme>) => void;
  setChat: (c: Partial<ChatSettings>) => void;
  setTheme: (t: ThemeMode) => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set, get) => ({
      providers: [],
      models: [],
      favorites: [],
      ui: {
        accent: "#0f172a",
        density: "comfortable",
      },
      chat: {
        defaultTemperature: 0.7,
        defaultMaxTokens: 4096,
        maxAgentSteps: 8,
        enabledTools: [],
        defaultSystemPrompt:
          "You are a helpful, capable AI assistant. When asked factual questions about current events, latest information, or anything that may have changed since your training, use the web_search tool. For math, use the calculate tool. For data processing, use execute_code. Always think step-by-step before answering.",
        thinkingMode: "off",
      },
      theme: "dark",
      setProviders: (providers) => set({ providers }),
      setModels: (models) => set({ models }),
      setFavorites: (favorites) => set({ favorites }),
      toggleFavorite: (providerId, modelName) => {
        const modelKey = `${providerId}:${modelName}`;
        const existing = get().favorites.find((f) => f.modelKey === modelKey);
        if (existing) {
          // Remove (optimistic — also call API)
          fetch(`/api/favorites/${encodeURIComponent(modelKey)}`, { method: "DELETE" });
          set((s) => ({
            favorites: s.favorites.filter((f) => f.modelKey !== modelKey),
          }));
        } else {
          // Add
          fetch("/api/favorites", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ providerId, modelName }),
          });
          set((s) => ({
            favorites: [...s.favorites, { modelKey, providerId, modelName }],
          }));
        }
      },
      isFavorite: (providerId, modelName) => {
        const modelKey = `${providerId}:${modelName}`;
        return get().favorites.some((f) => f.modelKey === modelKey);
      },
      setUi: (u) => set((s) => ({ ui: { ...s.ui, ...u } })),
      setChat: (c) => set((s) => ({ chat: { ...s.chat, ...c } })),
      setTheme: (theme) => set({ theme }),
    }),
    { name: "chat-settings" }
  )
);
