"use client";

import { ChevronDown, Check, Bot, Cpu } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { ProviderConfig, ModelConfig } from "@/lib/types";

interface ModelSelectorProps {
  providers: ProviderConfig[];
  models: ModelConfig[];
  providerId?: string;
  modelId?: string;
  onChange: (providerId: string, modelId: string) => void;
  className?: string;
}

export function ModelSelector({
  providers,
  models,
  providerId,
  modelId,
  onChange,
  className,
}: ModelSelectorProps) {
  const enabledProviders = providers.filter((p) => p.enabled);
  const currentProvider = enabledProviders.find((p) => p.id === providerId);
  const currentModel = models.find(
    (m) => m.id === modelId && m.providerId === providerId
  );

  const label = currentProvider && currentModel
    ? `${currentModel.displayName}`
    : "Select model";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn("h-8 gap-1.5 max-w-[260px]", className)}
        >
          {currentProvider?.isLocal ? (
            <Cpu className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0" />
          ) : (
            <Bot className="h-3.5 w-3.5 flex-shrink-0" />
          )}
          <span className="truncate">{label}</span>
          {currentProvider && (
            <span className="text-[0.65rem] text-muted-foreground hidden sm:inline">
              · {currentProvider.name}
            </span>
          )}
          <ChevronDown className="h-3 w-3 flex-shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-72 p-0"
        align="start"
      >
        <ScrollArea className="max-h-96">
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
                  <div className="flex items-center gap-1.5 px-2 py-1.5 text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground">
                    {p.isLocal && (
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    )}
                    {p.name}
                  </div>
                  {providerModels.map((m) => {
                    const active =
                      p.id === providerId && m.id === modelId;
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
                            {m.name} · {Math.round(m.contextWindow / 1000)}k ctx
                            {m.supportsVision && " · vision"}
                          </div>
                        </div>
                        {active && <Check className="h-3.5 w-3.5 flex-shrink-0" />}
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
