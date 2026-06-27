"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { Check, Search, Star, Eye, Brain, Wrench, Info, Cpu, X, RefreshCw, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProviderConfig, ModelConfig } from "@/lib/types";
import { useSettings } from "@/lib/stores/settings";
import { motion, AnimatePresence } from "framer-motion";

interface T3ModelPickerProps {
  providers: ProviderConfig[];
  models: ModelConfig[];
  providerId?: string;
  modelId?: string;
  onChange: (providerId: string, modelId: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  toolsHovered?: boolean;
}

// Provider icon (simple letter-based since we don't have brand SVGs)
function ProviderIcon({ name, isLocal }: { name: string; isLocal?: boolean }) {
  const letter = name.charAt(0).toUpperCase();
  if (isLocal) {
    return <Cpu className="h-4 w-4 text-emerald-500" />;
  }
  return (
    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-foreground/10 text-[0.6rem] font-bold text-foreground/70">
      {letter}
    </span>
  );
}

// Cost indicator (heuristic based on provider type)
function CostIndicator({ providerType, isLocal }: { providerType: string; isLocal?: boolean }) {
  if (isLocal) {
    return (
      <span className="inline-flex items-center gap-0 font-mono text-[0.65rem] tracking-tight text-emerald-600/70 dark:text-emerald-400">
        free
      </span>
    );
  }
  const cost = providerType === "anthropic" ? 3 : providerType === "openai" ? 2 : 1;
  return (
    <span className="inline-flex items-center gap-0 font-mono text-[0.65rem] tracking-tight text-muted-foreground/70">
      {Array.from({ length: cost }).map((_, i) => (
        <span key={i} className="text-red-600/85 dark:text-red-400">$</span>
      ))}
    </span>
  );
}

// Capability badges — eye (vision), wrench (tools), brain (thinking/reasoning)
function CapabilityBadges({ model }: { model: ModelConfig }) {
  return (
    <div className="flex items-center gap-0.5 rounded-full bg-foreground/[0.06] p-0.5">
      {model.supportsVision && (
        <span className="flex h-4 w-4 items-center justify-center text-foreground/50" title="Vision">
          <Eye className="h-3 w-3" />
        </span>
      )}
      {model.supportsTools && (
        <span className="flex h-4 w-4 items-center justify-center text-foreground/50" title="Tools">
          <Wrench className="h-3 w-3" />
        </span>
      )}
      <span className="flex h-4 w-4 items-center justify-center text-foreground/50" title="Reasoning">
        <Brain className="h-3 w-3" />
      </span>
    </div>
  );
}

// Star button — toggles favorite
function StarButton({
  isFavorite,
  onToggle,
}: {
  isFavorite: boolean;
  onToggle: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      onClick={onToggle}
      className={cn(
        "shrink-0 cursor-pointer rounded p-1 transition-colors",
        "hover:text-yellow-500",
        isFavorite
          ? "text-yellow-500 dark:text-yellow-400"
          : "text-muted-foreground/40"
      )}
      title={isFavorite ? "Remove from favorites" : "Add to favorites"}
    >
      <Star
        className={cn("h-3.5 w-3.5 transition-all", isFavorite && "fill-current")}
      />
    </button>
  );
}

export function T3ModelPicker({
  providers,
  models,
  providerId,
  modelId,
  onChange,
  open,
  onOpenChange,
  toolsHovered = false,
}: T3ModelPickerProps) {
  const [search, setSearch] = useState("");
  const [activeProvider, setActiveProvider] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [infoModel, setInfoModel] = useState<{ model: ModelConfig; provider: ProviderConfig } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { favorites, toggleFavorite, isFavorite } = useSettings();

  const enabledProviders = useMemo(
    () => providers.filter((p) => p.enabled),
    [providers]
  );

  const currentProvider = enabledProviders.find((p) => p.id === providerId);
  const currentModel = models.find(
    (m) => m.id === modelId && m.providerId === providerId
  );

  // Favorite models (resolved to full model info)
  const favoriteModels = useMemo(() => {
    return favorites
      .map((f) => {
        const model = models.find(
          (m) => m.providerId === f.providerId && m.name === f.modelName
        );
        const provider = enabledProviders.find((p) => p.id === f.providerId);
        return model && provider ? { model, provider } : null;
      })
      .filter(Boolean) as Array<{ model: ModelConfig; provider: ProviderConfig }>;
  }, [favorites, models, enabledProviders]);

  // Filter models by search and active provider
  const filteredModels = useMemo(() => {
    let list = models;
    if (activeProvider) {
      list = list.filter((m) => m.providerId === activeProvider);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (m) =>
          m.displayName.toLowerCase().includes(q) ||
          m.name.toLowerCase().includes(q)
      );
    }
    return list;
  }, [models, activeProvider, search]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onOpenChange(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, onOpenChange]);

  // Clear info popover when dropdown closes
  useEffect(() => {
    if (!open) setInfoModel(null);
  }, [open]);

  // Close on escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onOpenChange]);

  // Reset search when closing (delayed to avoid animation conflict)
  useEffect(() => {
    if (!open) {
      const t = setTimeout(() => {
        setSearch("");
        setActiveProvider(null);
      }, 200);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Refresh models from providers
  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await fetch("/api/models/refresh", { method: "POST" });
      // Reload providers to get fresh models
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
    } catch (e) {
      console.error("Refresh failed:", e);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      {/* The trigger button — completely invisible until hover (parent state), subtle on hover */}
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className={cn(
          "flex items-center gap-1 h-7 px-2 rounded-lg transition-all duration-200",
          "text-xs",
          open
            ? "text-foreground bg-foreground/5"
            : toolsHovered
              ? "text-foreground/50 hover:text-foreground hover:bg-foreground/5"
              : "text-transparent"
        )}
        title="Select model"
      >
        {currentProvider?.isLocal ? (
          <Cpu
            className={cn(
              "h-3 w-3 flex-shrink-0 transition-opacity",
              open
                ? "opacity-100 text-emerald-500"
                : toolsHovered
                  ? "opacity-40 hover:!opacity-100"
                  : "opacity-0"
            )}
          />
        ) : (
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full flex-shrink-0 transition-opacity bg-foreground",
              open
                ? "opacity-100"
                : toolsHovered
                  ? "opacity-40 hover:!opacity-100"
                  : "opacity-0"
            )}
          />
        )}
        <span
          className={cn(
            "truncate max-w-[140px] transition-opacity",
            !open && (toolsHovered ? "opacity-100" : "opacity-0")
          )}
        >
          {currentModel?.displayName || "Select"}
        </span>
      </button>

      {/* Dropdown — T3.chat style, opens ABOVE the trigger */}
      <AnimatePresence>
        {open && (
          <>
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.97 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="absolute bottom-full left-0 mb-2 w-[460px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-border bg-card shadow-2xl z-50"
          >
            {/* Subtle gradient overlay (visible in dark mode) */}
            <div className="pointer-events-none absolute inset-0 opacity-0 dark:opacity-30 bg-gradient-to-br from-foreground/[0.03] via-transparent to-foreground/[0.03]" />

            <div className="relative">
              {/* Search bar + refresh button */}
              <div className="flex items-center gap-2 px-4 pt-3 pb-2 border-b border-border/40">
                <Search className="h-4 w-4 shrink-0 text-muted-foreground/60" />
                <input
                  placeholder="Search models..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  type="text"
                  className="w-full bg-transparent py-1.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
                  autoFocus
                />
                {search && (
                  <button
                    onClick={() => setSearch("")}
                    className="text-muted-foreground/60 hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
                <button
                  onClick={handleRefresh}
                  disabled={refreshing}
                  className="text-muted-foreground/60 hover:text-foreground transition-colors p-1"
                  title="Refresh model list from providers"
                >
                  {refreshing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>

              {/* Provider icon tabs */}
              <div className="flex items-center gap-1 px-2 py-2 overflow-x-auto border-b border-border/40">
                <button
                  onClick={() => setActiveProvider(null)}
                  className={cn(
                    "group relative flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-xl transition-all hover:bg-foreground/5",
                    !activeProvider && "bg-foreground/5"
                  )}
                  title="All"
                >
                  <span className="text-[0.6rem] font-semibold text-muted-foreground uppercase">All</span>
                  {!activeProvider && (
                    <div className="absolute top-1/2 -right-1 h-6 w-0.5 -translate-y-1/2 rounded-full bg-foreground" />
                  )}
                </button>
                {enabledProviders.map((p) => {
                  const isActive = activeProvider === p.id;
                  return (
                    <button
                      key={p.id}
                      onClick={() => setActiveProvider(isActive ? null : p.id)}
                      className={cn(
                        "group relative flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-xl transition-all hover:bg-foreground/5"
                      )}
                      title={p.name}
                    >
                      <ProviderIcon name={p.name} isLocal={p.isLocal} />
                      {isActive && (
                        <div className="absolute top-1/2 -right-1 h-6 w-0.5 -translate-y-1/2 rounded-full bg-foreground" />
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Model list */}
              <div className="max-h-[400px] overflow-y-auto p-1.5">
                {/* Favorites section */}
                {favoriteModels.length > 0 && !search && !activeProvider && (
                  <div className="mb-2">
                    <div className="flex items-center gap-1.5 px-2 py-1.5 text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground">
                      <Star className="h-3 w-3 text-yellow-500" />
                      Favorites
                    </div>
                    {favoriteModels.map(({ model, provider }) => {
                      const active = model.id === modelId && model.providerId === providerId;
                      const fav = isFavorite(provider.id, model.name);
                      return (
                        <ModelRow
                          key={model.id}
                          model={model}
                          provider={provider}
                          active={active}
                          isFavorite={fav}
                          onStarToggle={(e) => {
                            e.stopPropagation();
                            toggleFavorite(provider.id, model.name);
                          }}
                          onSelect={() => {
                            onChange(provider.id, model.id);
                            onOpenChange(false);
                          }}
                          onInfoToggle={(m, p) => setInfoModel(infoModel?.model.id === m.id ? null : { model: m, provider: p })}
                          infoOpen={infoModel?.model.id === model.id}
                        />
                      );
                    })}
                  </div>
                )}

                {/* All models */}
                {(!search && !activeProvider && favoriteModels.length > 0) && (
                  <div className="flex items-center gap-1.5 px-2 py-1.5 text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground">
                    All Models
                  </div>
                )}
                {filteredModels.length === 0 && (
                  <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                    {search ? `No models found for "${search}"` : "No models available"}
                  </div>
                )}
                {filteredModels.map((m) => {
                  const provider = enabledProviders.find((p) => p.id === m.providerId);
                  if (!provider) return null; // skip models whose provider is disabled/deleted
                  const active = m.id === modelId && m.providerId === providerId;
                  const fav = isFavorite(m.providerId, m.name);
                  return (
                    <ModelRow
                      key={m.id}
                      model={m}
                      provider={provider}
                      active={active}
                      isFavorite={fav}
                      onStarToggle={(e) => {
                        e.stopPropagation();
                        toggleFavorite(m.providerId, m.name);
                      }}
                      onSelect={() => {
                        onChange(m.providerId, m.id);
                        onOpenChange(false);
                      }}
                      onInfoToggle={(mod, p) => setInfoModel(infoModel?.model.id === mod.id ? null : { model: mod, provider: p })}
                      infoOpen={infoModel?.model.id === m.id}
                    />
                  );
                })}
              </div>
            </div>
          </motion.div>

          {/* Info popover — pops out to the RIGHT side of the dropdown, outside of it */}
          <AnimatePresence>
            {infoModel && (
              <motion.div
                initial={{ opacity: 0, x: -10, scale: 0.97 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: -10, scale: 0.97 }}
                transition={{ duration: 0.15, ease: "easeOut" }}
                className="absolute bottom-full left-[468px] mb-2 w-80 rounded-lg border border-border bg-card shadow-2xl p-3 z-50"
              >
                <ModelInfoContent model={infoModel.model} provider={infoModel.provider} />
              </motion.div>
            )}
          </AnimatePresence>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

// Reusable model row component — uses div with role=button to allow nested buttons (star, info, etc.)
function ModelRow({
  model,
  provider,
  active,
  isFavorite,
  onStarToggle,
  onSelect,
  onInfoToggle,
  infoOpen,
}: {
  model: ModelConfig;
  provider: ProviderConfig;
  active: boolean;
  isFavorite: boolean;
  onStarToggle: (e: React.MouseEvent) => void;
  onSelect: () => void;
  onInfoToggle: (model: ModelConfig, provider: ProviderConfig) => void;
  infoOpen: boolean;
}) {
  return (
    <div
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        "group flex h-16 w-full items-center gap-3 rounded-lg p-3 text-left transition-all hover:bg-foreground/[0.04] cursor-pointer",
        active && "bg-foreground/[0.06]"
      )}
    >
      <ProviderIcon name={provider.name} isLocal={provider.isLocal} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-semibold truncate">{model.displayName}</p>
          {/* Provider badge — shows which provider serves this model */}
          <span className={cn(
            "text-[0.6rem] font-medium px-1.5 py-0.5 rounded shrink-0",
            provider.isLocal
              ? "bg-emerald-500/15 text-emerald-400"
              : "bg-foreground/10 text-muted-foreground"
          )}>
            {provider.name}
          </span>
          <CostIndicator providerType={provider.type} isLocal={provider.isLocal} />
          <StarButton isFavorite={isFavorite} onToggle={onStarToggle} />
          {active && (
            <Check className="h-3 w-3 text-foreground ml-auto" />
          )}
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground/60">
          {Math.round(model.contextWindow / 1000)}k context
          {model.supportsVision && " · vision"}
          {model.supportsTools && " · tools"}
        </p>
      </div>

      {/* Right side: capability badges + info button */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <CapabilityBadges model={model} />
        {/* Info (i) button — opens model details popover (rendered at picker level, outside dropdown) */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onInfoToggle(model, provider);
          }}
          className={cn(
            "flex h-5 w-5 items-center justify-center rounded transition-colors",
            infoOpen
              ? "text-foreground bg-foreground/10"
              : "text-muted-foreground/50 hover:text-foreground hover:bg-foreground/10"
          )}
          title="Model details"
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

// Model info popover content — T3.chat style with sections, labels, feature pills
function ModelInfoContent({
  model,
  provider,
}: {
  model: ModelConfig;
  provider: ProviderConfig;
}) {
  const { chat, setChat } = useSettings();

  // Generate a description based on model name
  const description = useMemo(() => {
    const name = model.name.toLowerCase();
    if (name.includes("gpt-4o")) return "GPT-4o is OpenAI's flagship multimodal model capable of a wide range of tasks including vision, code generation, and complex reasoning.";
    if (name.includes("gpt-4")) return "GPT-4 is a powerful large language model by OpenAI, excelling at complex tasks.";
    if (name.includes("gpt-3.5")) return "GPT-3.5 is a fast, cost-effective model for everyday tasks.";
    if (name.includes("o1")) return "o1 is an OpenAI reasoning model that thinks before answering.";
    if (name.includes("claude-3-5-sonnet")) return "Claude 3.5 Sonnet is Anthropic's best model for real-world tasks with superior performance.";
    if (name.includes("claude-3-5-haiku")) return "Claude 3.5 Haiku is the fastest model in the Claude 3.5 family.";
    if (name.includes("claude-3-opus")) return "Claude 3 Opus is Anthropic's flagship model with top-tier performance.";
    if (name.includes("glm-4-plus")) return "GLM-4-Plus is Z.ai's flagship model with strong reasoning capabilities.";
    if (name.includes("glm-4-flash")) return "GLM-4-Flash is a free, fast model from Z.ai.";
    if (name.includes("llama")) return "Llama is Meta's open-source large language model.";
    if (name.includes("qwen")) return "Qwen is Alibaba's multilingual language model.";
    if (name.includes("mistral")) return "Mistral is an efficient European language model.";
    return `${model.displayName} is an AI model available from ${provider.name}.`;
  }, [model.name, model.displayName, provider.name]);

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <ProviderIcon name={provider.name} isLocal={provider.isLocal} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-semibold">{model.displayName}</p>
            <CostIndicator providerType={provider.type} isLocal={provider.isLocal} />
          </div>
        </div>
      </div>

      {/* Description section */}
      <div>
        <div className="text-[0.65rem] font-semibold text-foreground uppercase tracking-wide mb-1">Description</div>
        <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
      </div>

      {/* Features section — pill-shaped badges with colors */}
      <div>
        <div className="text-[0.65rem] font-semibold text-foreground uppercase tracking-wide mb-1.5">Features</div>
        <div className="flex flex-wrap gap-1">
          {model.supportsVision && (
            <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-2 py-0.5 text-[0.65rem] text-emerald-400">
              <Eye className="h-2.5 w-2.5" /> Vision
            </span>
          )}
          {model.supportsTools && (
            <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/15 px-2 py-0.5 text-[0.65rem] text-amber-400">
              <Wrench className="h-2.5 w-2.5" /> Tool Calling
            </span>
          )}
          <span className="inline-flex items-center gap-1 rounded-md bg-purple-500/15 px-2 py-0.5 text-[0.65rem] text-purple-400">
            <Brain className="h-2.5 w-2.5" /> Reasoning
          </span>
          <span className="inline-flex items-center gap-1 rounded-md bg-teal-500/15 px-2 py-0.5 text-[0.65rem] text-teal-400">
            <Brain className="h-2.5 w-2.5" /> Effort Control
          </span>
        </div>
      </div>

      {/* Provider & Context — two columns */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className="text-[0.6rem] text-muted-foreground uppercase tracking-wide">Provider</div>
          <div className="text-xs font-medium text-foreground">{provider.name}</div>
        </div>
        <div>
          <div className="text-[0.6rem] text-muted-foreground uppercase tracking-wide">Context</div>
          <div className="text-xs font-medium text-foreground">{Math.round(model.contextWindow / 1000)}k tokens</div>
        </div>
      </div>

      {/* Model ID */}
      <div>
        <div className="text-[0.6rem] text-muted-foreground uppercase tracking-wide">Model ID</div>
        <div className="text-[0.7rem] font-mono text-muted-foreground truncate">{model.name}</div>
      </div>

      {/* Thinking mode selector */}
      <div className="border-t border-border/40 pt-3">
        <div className="text-[0.65rem] font-semibold text-foreground uppercase tracking-wide mb-1.5 flex items-center gap-1">
          <Brain className="h-2.5 w-2.5" /> Thinking Effort
        </div>
        <div className="flex gap-1">
          {([
            { value: "off", label: "Off" },
            { value: "low", label: "Low" },
            { value: "medium", label: "Medium" },
            { value: "high", label: "High" },
          ] as const).map((opt) => (
            <button
              key={opt.value}
              onClick={(e) => {
                e.stopPropagation();
                setChat({ thinkingMode: opt.value });
              }}
              className={cn(
                "flex-1 rounded-md py-1 text-[0.65rem] font-medium transition-colors",
                chat.thinkingMode === opt.value
                  ? "bg-foreground text-background"
                  : "bg-foreground/[0.06] text-muted-foreground hover:bg-foreground/[0.1]"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
