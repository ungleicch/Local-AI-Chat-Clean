"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Plus,
  Trash2,
  Key,
  Cpu,
  Bot,
  RefreshCw,
  Loader2,
  CheckCircle2,
  XCircle,
  Eye,
  EyeOff,
  Brain,
  History,
  AlertCircle,
  Check,
  FileText,
} from "lucide-react";
import type { ProviderConfig, ModelConfig, ProviderType } from "@/lib/types";
import { useSettings } from "@/lib/stores/settings";
import { useToast } from "@/hooks/use-toast";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[88vh] overflow-hidden flex flex-col gap-0 p-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/40">
          <DialogTitle className="text-lg font-semibold">Settings</DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="providers" className="flex-1 overflow-hidden flex flex-col px-6 pb-6">
          <TabsList className="grid w-full grid-cols-5 text-xs h-9 mb-4 bg-card border border-border">
            <TabsTrigger value="providers" className="rounded-md">Providers</TabsTrigger>
            <TabsTrigger value="agent" className="rounded-md">Agent</TabsTrigger>
            <TabsTrigger value="soul" className="rounded-md">Soul</TabsTrigger>
            <TabsTrigger value="memory" className="rounded-md">Memory</TabsTrigger>
            <TabsTrigger value="files" className="rounded-md">Files</TabsTrigger>
          </TabsList>
          <TabsContent value="providers" className="flex-1 overflow-y-auto mt-0">
            <ProvidersTab />
          </TabsContent>
          <TabsContent value="agent" className="flex-1 overflow-y-auto mt-0">
            <AgentTab />
          </TabsContent>
          <TabsContent value="soul" className="flex-1 overflow-y-auto mt-0">
            <SoulTab />
          </TabsContent>
          <TabsContent value="memory" className="flex-1 overflow-y-auto mt-0">
            <MemoryTab />
          </TabsContent>
          <TabsContent value="files" className="flex-1 overflow-y-auto mt-0">
            <FilesTab />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Providers Tab ----------
function ProvidersTab() {
  const { toast } = useToast();
  const { providers, models, setProviders, setModels } = useSettings();
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await fetch("/api/providers");
      const data = await resp.json();
      const mapped: ProviderConfig[] = data.providers.map((p: any) => ({
        id: p.id,
        name: p.name,
        type: p.type as ProviderType,
        baseUrl: p.baseUrl,
        apiKey: p.apiKey || undefined,
        enabled: p.enabled,
        isLocal: p.isLocal,
      }));
      setProviders(mapped);
      const allModels: ModelConfig[] = data.providers.flatMap((p: any) =>
        (p.models || []).map((m: any) => ({
          id: m.id,
          providerId: p.id,
          name: m.name,
          displayName: m.displayName,
          contextWindow: m.contextWindow,
          supportsTools: m.supportsTools,
          supportsVision: m.supportsVision,
        }))
      );
      setModels(allModels);
    } catch (e) {
      toast({
        title: "Failed to load providers",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [setProviders, setModels, toast]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleSeed = async () => {
    try {
      const resp = await fetch("/api/seed", { method: "POST" });
      const data = await resp.json();
      if (data.seeded) {
        toast({
          title: "Default providers added",
          description: `Seeded ${data.count} providers.`,
        });
        refresh();
      } else {
        toast({ title: "Already seeded" });
      }
    } catch (e) {
      toast({
        title: "Seed failed",
        description: (e as Error).message,
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-5 py-2">
      {/* Section header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-medium text-foreground">AI Providers</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Configure API keys and manage model availability. Local providers (Ollama, LM Studio) auto-detect models.
          </p>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <Button variant="outline" size="sm" onClick={handleSeed} className="h-8">
            <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Defaults
          </Button>
          <Button variant="ghost" size="sm" onClick={refresh} disabled={loading} className="h-8 w-8 p-0">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>

      {providers.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <Bot className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm font-medium">No providers configured</p>
          <p className="text-xs text-muted-foreground mt-1">Click "Defaults" to seed providers.</p>
        </div>
      )}

      <div className="space-y-3">
        {providers.map((p) => (
          <ProviderCard
            key={p.id}
            provider={p}
            models={models.filter((m) => m.providerId === p.id)}
            onChanged={refresh}
          />
        ))}
      </div>

      <AddProviderForm onAdded={refresh} />
    </div>
  );
}

function ProviderCard({
  provider,
  models,
  onChanged,
}: {
  provider: ProviderConfig;
  models: ModelConfig[];
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [name, setName] = useState(provider.name);
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl);
  const [apiKey, setApiKey] = useState(provider.apiKey || "");
  const [enabled, setEnabled] = useState(provider.enabled);
  const [probing, setProbing] = useState(false);

  const save = async () => {
    try {
      await fetch(`/api/providers/${provider.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name, type: provider.type, baseUrl, apiKey: apiKey || null, enabled, isLocal: provider.isLocal,
        }),
      });
      setEditing(false);
      onChanged();
      toast({ title: "Provider updated" });
    } catch (e) {
      toast({ title: "Save failed", description: (e as Error).message, variant: "destructive" });
    }
  };

  const del = async () => {
    if (!confirm(`Delete "${provider.name}"?`)) return;
    try {
      await fetch(`/api/providers/${provider.id}`, { method: "DELETE" });
      onChanged();
      toast({ title: "Provider deleted" });
    } catch (e) {
      toast({ title: "Delete failed", description: (e as Error).message, variant: "destructive" });
    }
  };

  const probe = async () => {
    setProbing(true);
    try {
      const resp = await fetch("/api/providers/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: provider.type, baseUrl }),
      });
      const data = await resp.json();
      if (resp.ok && data.models?.length > 0) {
        const existing = new Set(models.map((m) => m.name));
        const toAdd = data.models.filter((m: any) => !existing.has(m.name));
        for (const m of toAdd) {
          await fetch("/api/models", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ providerId: provider.id, ...m }),
          });
        }
        onChanged();
        toast({ title: `Added ${toAdd.length} models` });
      } else {
        toast({ title: "Probe failed", description: data.error, variant: "destructive" });
      }
    } catch (e) {
      toast({ title: "Probe failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setProbing(false);
    }
  };

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="flex items-center gap-3 p-3 bg-muted/30">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-background border border-border">
          {provider.isLocal ? <Cpu className="h-4 w-4 text-emerald-500" /> : <Bot className="h-4 w-4" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">{provider.name}</span>
            <Badge variant="outline" className="text-[0.65rem] py-0 px-1.5">{provider.type}</Badge>
            {provider.isLocal && (
              <Badge variant="outline" className="text-[0.65rem] py-0 px-1.5 text-emerald-600 border-emerald-600/30">local</Badge>
            )}
            {!provider.enabled && (
              <Badge variant="outline" className="text-[0.65rem] py-0 px-1.5 text-muted-foreground">disabled</Badge>
            )}
          </div>
          <div className="text-[0.7rem] text-muted-foreground truncate font-mono">{provider.baseUrl}</div>
        </div>
        <div className="flex items-center gap-1">
          {provider.isLocal && (
            <Button variant="ghost" size="sm" onClick={probe} disabled={probing} className="h-7 text-xs">
              {probing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              <span className="ml-1 hidden sm:inline">Probe</span>
            </Button>
          )}
          <Switch checked={enabled} onCheckedChange={async (v) => {
            setEnabled(v);
            await fetch(`/api/providers/${provider.id}`, {
              method: "PATCH", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ enabled: v }),
            });
            onChanged();
          }} />
        </div>
      </div>

      {editing ? (
        <div className="p-3 space-y-3 border-t border-border">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8 text-sm" />
            </div>
            <div>
              <Label className="text-xs">Base URL</Label>
              <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} className="h-8 text-sm font-mono" />
            </div>
          </div>
          <div>
            <Label className="text-xs flex items-center gap-1"><Key className="h-3 w-3" /> API Key</Label>
            <div className="relative">
              <Input type={showKey ? "text" : "password"} value={apiKey} onChange={(e) => setApiKey(e.target.value)}
                placeholder={provider.isLocal ? "Not required" : "sk-..."} className="h-8 text-sm font-mono pr-9" />
              <Button variant="ghost" size="icon" type="button" className="absolute right-1 top-1 h-6 w-6"
                onClick={() => setShowKey(!showKey)}>
                {showKey ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              </Button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={save}>Save</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
            <Button size="sm" variant="ghost" className="ml-auto text-destructive" onClick={del}>
              <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
            </Button>
          </div>
        </div>
      ) : (
        <div className="p-3 border-t border-border">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-muted-foreground">{models.length} model{models.length !== 1 ? "s" : ""}</span>
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)} className="h-6 text-xs">Edit</Button>
          </div>
          {models.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {models.map((m) => (
                <Badge key={m.id} variant="secondary" className="text-[0.7rem] py-1">{m.displayName}</Badge>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AddProviderForm({ onAdded }: { onAdded: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<ProviderType>("openai");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [isLocal, setIsLocal] = useState(false);

  const reset = () => { setName(""); setType("openai"); setBaseUrl(""); setApiKey(""); setIsLocal(false); setOpen(false); };

  const submit = async () => {
    if (!name || !baseUrl) { toast({ title: "Name and Base URL required", variant: "destructive" }); return; }
    try {
      await fetch("/api/providers", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, type, baseUrl, apiKey: apiKey || null, isLocal, enabled: true, models: [] }),
      });
      reset(); onAdded(); toast({ title: "Provider added" });
    } catch (e) {
      toast({ title: "Add failed", description: (e as Error).message, variant: "destructive" });
    }
  };

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="w-full">
        <Plus className="h-3.5 w-3.5 mr-1" /> Add custom provider
      </Button>
    );
  }

  return (
    <div className="rounded-lg border border-border p-3 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8 text-sm" />
        </div>
        <div>
          <Label className="text-xs">Type</Label>
          <Select value={type} onValueChange={(v) => setType(v as ProviderType)}>
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="openai">OpenAI-compatible</SelectItem>
              <SelectItem value="anthropic">Anthropic</SelectItem>
              <SelectItem value="glm">GLM (Z.ai)</SelectItem>
              <SelectItem value="openrouter">OpenRouter</SelectItem>
              <SelectItem value="ollama">Ollama (local)</SelectItem>
              <SelectItem value="lmstudio">LM Studio (local)</SelectItem>
              <SelectItem value="custom">Custom</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div>
        <Label className="text-xs">Base URL</Label>
        <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} className="h-8 text-sm font-mono" />
      </div>
      <div>
        <Label className="text-xs">API Key</Label>
        <Input value={apiKey} onChange={(e) => setApiKey(e.target.value)} type="password" className="h-8 text-sm font-mono" />
      </div>
      <div className="flex items-center gap-2">
        <Switch checked={isLocal} onCheckedChange={setIsLocal} id="isLocal2" />
        <Label htmlFor="isLocal2" className="text-xs">Local server</Label>
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={submit}>Add</Button>
        <Button size="sm" variant="ghost" onClick={reset}>Cancel</Button>
      </div>
    </div>
  );
}

// ---------- Agent Tab ----------
function AgentTab() {
  const { chat, setChat } = useSettings();
  return (
    <div className="space-y-4 py-2">
      <div>
        <Label className="text-sm font-medium">Default System Prompt</Label>
        <Textarea value={chat.defaultSystemPrompt} onChange={(e) => setChat({ defaultSystemPrompt: e.target.value })} rows={4} className="text-sm" />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <Label className="text-sm">Temperature</Label>
          <Input type="number" min={0} max={2} step={0.1} value={chat.defaultTemperature}
            onChange={(e) => setChat({ defaultTemperature: Number(e.target.value) })} className="h-8" />
        </div>
        <div>
          <Label className="text-sm">Max tokens</Label>
          <Input type="number" min={256} step={256} value={chat.defaultMaxTokens}
            onChange={(e) => setChat({ defaultMaxTokens: Number(e.target.value) })} className="h-8" />
        </div>
        <div>
          <Label className="text-sm">Max steps</Label>
          <Input type="number" min={1} max={20} value={chat.maxAgentSteps}
            onChange={(e) => setChat({ maxAgentSteps: Number(e.target.value) })} className="h-8" />
        </div>
      </div>
      <div className="rounded-lg border border-border p-3 bg-muted/30">
        <p className="text-xs text-muted-foreground">
          All tools are enabled by default. The agent decides autonomously which to use.
          Available tools: web_search, web_fetch, execute_code, calculate, read/write_file, list_files,
          memory_search/store, read_soul/update_soul, search_chat_history, read_past_chat, list_past_chats,
          knowledge_search/store, create_env, run_in_env, copy_from_env, kill_env, list_envs, write_env_file, read_env_file,
          find_files, read_system_file, write_system_file, list_pending_changes, restore_file,
          create_tool, list_custom_tools, delete_custom_tool, extract_file, list_uploaded_files.
        </p>
      </div>
    </div>
  );
}

// ---------- Soul Tab ----------
function SoulTab() {
  const { toast } = useToast();
  const [content, setContent] = useState("");
  const [version, setVersion] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Use the soul tools via chat API is overkill; read directly via a temp API
      const resp = await fetch("/api/soul");
      const data = await resp.json();
      if (data.soul) {
        setContent(data.soul.content);
        setVersion(data.soul.version);
      } else {
        setContent("");
        setVersion(null);
      }
    } catch (e) {
      toast({ title: "Failed to load soul", description: (e as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    try {
      const resp = await fetch("/api/soul", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const data = await resp.json();
      setVersion(data.soul.version);
      toast({ title: `Soul saved (v${data.soul.version})` });
    } catch (e) {
      toast({ title: "Save failed", description: (e as Error).message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-3 py-2">
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-sm font-medium flex items-center gap-1.5">
            <Bot className="h-4 w-4" /> Soul File
          </Label>
          <p className="text-xs text-muted-foreground mt-0.5">
            The agent's self-modifiable personality prompt. The agent can read and update this autonomously via the read_soul/update_soul tools.
          </p>
        </div>
        {version !== null && (
          <Badge variant="outline" className="text-xs">v{version}</Badge>
        )}
      </div>
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={12}
          placeholder="Define the agent's personality here. The agent will see this as 'YOUR SOUL' in its system prompt. It can modify this itself using update_soul."
          className="text-sm font-mono"
        />
      )}
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          The agent can edit this file itself — changes here are also persisted.
        </p>
        <Button size="sm" onClick={save} disabled={loading}>
          <Check className="h-3.5 w-3.5 mr-1" /> Save soul
        </Button>
      </div>
    </div>
  );
}

// ---------- Memory Tab ----------
function MemoryTab() {
  const { toast } = useToast();
  const [memories, setMemories] = useState<Array<{ id: string; key: string; value: string; source: string | null }>>([]);
  const [knowledge, setKnowledge] = useState<Array<{ id: string; content: string; tags: string | null }>>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [memResp, knowResp] = await Promise.all([
        fetch("/api/memory"),
        fetch("/api/memory?kind=knowledge"),
      ]);
      const memData = await memResp.json();
      const knowData = await knowResp.json();
      setMemories(memData.entries || []);
      setKnowledge(knowData.entries || []);
    } catch (e) {
      toast({ title: "Failed to load memory", description: (e as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const deleteMem = async (id: string) => {
    try {
      await fetch(`/api/memory?id=${id}`, { method: "DELETE" });
      load();
    } catch (e) {
      toast({ title: "Delete failed", description: (e as Error).message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4 py-2">
      <div>
        <Label className="text-sm font-medium flex items-center gap-1.5">
          <Brain className="h-4 w-4" /> User Profile Memory
        </Label>
        <p className="text-xs text-muted-foreground mt-0.5 mb-2">
          Facts the agent has learned about you. It searches these via memory_search.
        </p>
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : memories.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">No memories yet. Tell the agent about yourself in a chat.</p>
        ) : (
          <div className="space-y-1.5">
            {memories.map((m) => (
              <div key={m.id} className="flex items-start gap-2 rounded-md border border-border p-2 text-xs">
                <div className="flex-1 min-w-0">
                  <div className="font-medium">{m.key}</div>
                  <div className="text-muted-foreground break-words">{m.value}</div>
                </div>
                <button onClick={() => deleteMem(m.id)} className="text-muted-foreground hover:text-destructive">
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <Label className="text-sm font-medium flex items-center gap-1.5">
          <History className="h-4 w-4" /> Knowledge Entries
        </Label>
        <p className="text-xs text-muted-foreground mt-0.5 mb-2">
          General facts extracted from conversations.
        </p>
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : knowledge.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">No knowledge entries yet.</p>
        ) : (
          <div className="space-y-1.5 max-h-60 overflow-y-auto">
            {knowledge.map((k) => (
              <div key={k.id} className="rounded-md border border-border p-2 text-xs">
                <div className="break-words">{k.content}</div>
                {k.tags && <div className="text-muted-foreground mt-1 text-[0.65rem]">tags: {k.tags}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- Files Tab (pending changes + uploads) ----------
function FilesTab() {
  const { toast } = useToast();
  const [changes, setChanges] = useState<Array<{ id: string; originalPath: string; backupPath: string; createdAt: string }>>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await fetch("/api/changes");
      const data = await resp.json();
      setChanges(data.changes || []);
    } catch (e) {
      toast({ title: "Failed to load changes", description: (e as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const acceptAll = async () => {
    try {
      await fetch("/api/changes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      toast({ title: "All changes accepted" });
      load();
    } catch (e) {
      toast({ title: "Failed", description: (e as Error).message, variant: "destructive" });
    }
  };

  const restore = async (id: string) => {
    try {
      await fetch("/api/changes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
      toast({ title: "Change accepted (file kept)" });
      load();
    } catch (e) {
      toast({ title: "Failed", description: (e as Error).message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-3 py-2">
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-sm font-medium flex items-center gap-1.5">
            <AlertCircle className="h-4 w-4" /> Pending File Changes
          </Label>
          <p className="text-xs text-muted-foreground mt-0.5">
            Files the agent has modified. Each has a backup. Accept to keep, or restore to undo.
          </p>
        </div>
        {changes.length > 0 && (
          <Button size="sm" onClick={acceptAll}>
            <Check className="h-3.5 w-3.5 mr-1" /> Accept all
          </Button>
        )}
      </div>
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : changes.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">No pending changes.</p>
      ) : (
        <div className="space-y-1.5">
          {changes.map((c) => (
            <div key={c.id} className="flex items-center gap-2 rounded-md border border-border p-2 text-xs">
              <FileText className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
              <div className="flex-1 min-w-0">
                <div className="font-mono truncate">{c.originalPath}</div>
                <div className="text-muted-foreground text-[0.65rem]">
                  Changed {new Date(c.createdAt).toLocaleString()}
                </div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => restore(c.id)} className="h-6 text-xs">
                Accept
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
