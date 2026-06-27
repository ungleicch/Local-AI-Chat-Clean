"use client";

import { ChevronUp, Check, Cpu, Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { ProviderConfig, ModelConfig } from "@/lib/types";

interface ModelPickerProps {
  providers: ProviderConfig[];
  models: ModelConfig[];
  providerId?: string;
  modelId?: string;
  onChange: (providerId: string, modelId: string) => void;
}

/**
 * T3-chat-style model picker — a subtle pill above/beside the input.
 * Shows model name on hover; expands on click.
 */
export function ModelPicker({
  providers,
  models,
  providerId,
  modelId,
  onChange,
}: ModelPickerProps) {
  const enabledProviders = providers.filter((p) => p.enabled);
  const currentProvider = enabledProviders.find((p) => p.id === providerId);
  const currentModel = models.find(
    (m) => m.id === modelId && m.providerId === providerId
  );

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "group flex items-center gap-1.5 h-7 px-2.5 rounded-full",
            "text-xs text-muted-foreground hover:text-foreground",
            "hover:bg-accent/50 transition-all duration-200",
            "opacity-60 hover:opacity-100"
          )}
          title="Select model"
        >
          {currentProvider?.isLocal ? (
            <Cpu className="h-3 w-3 text-emerald-500 flex-shrink-0" />
          ) : (
            <Bot className="h-3 w-3 flex-shrink-0" />
          )}
          <span className="truncate max-w-[160px]">
            {currentModel?.displayName || "Select model"}
          </span>
          <ChevronUp className="h-3 w-3 flex-shrink-0 opacity-50 group-hover:opacity-100" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-72 p-0 border-border/60 shadow-xl"
        align="start"
        side="top"
        sideOffset={8}
      >
        <ScrollArea className="max-h-80">
          <div className="p-1">
            {enabledProviders.length === 0 && (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                No providers configured.
                <br />
                Open Settings to add one.
              </div>
            )}
            {enabledProviders.map((p) => {
              const providerModels = models.filter(
                (m) => m.providerId === p.id
              );
              if (providerModels.length === 0) return null;
              return (
                <div key={p.id} className="mb-1">
                  <div className="flex items-center gap-1.5 px-2 py-1.5 text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground">
                    {p.isLocal && (
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    )}
                    {p.name}
                  </div>
                  {providerModels.map((m) => {
                    const active = p.id === providerId && m.id === modelId;
                    return (
                      <button
                        key={m.id}
                        onClick={() => onChange(p.id, m.id)}
                        className={cn(
                          "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-accent transition-colors",
                          active && "bg-accent"
                        )}
                      >
                        <div className="min-w-0 flex-1 text-left">
                          <div className="truncate text-[0.8rem]">
                            {m.displayName}
                          </div>
                          <div className="text-[0.65rem] text-muted-foreground truncate">
                            {m.name} · {Math.round(m.contextWindow / 1000)}k
                            {m.supportsVision && " · vision"}
                          </div>
                        </div>
                        {active && (
                          <Check className="h-3.5 w-3.5 flex-shrink-0 text-foreground" />
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
