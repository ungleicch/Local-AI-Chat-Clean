// Dynamic model fetching with 24h cache and capability detection
import { db } from "./db";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface FetchedModel {
  name: string;
  displayName: string;
  contextWindow: number;
  supportsTools: boolean;
  supportsVision: boolean;
  description?: string;
}

// Heuristic capability detection based on model name
function detectCapabilities(modelName: string): {
  supportsTools: boolean;
  supportsVision: boolean;
  contextWindow: number;
  description: string;
} {
  const name = modelName.toLowerCase();
  const supportsVision =
    name.includes("vision") ||
    name.includes("llava") ||
    name.includes("gpt-4o") ||
    name.includes("gpt-4-turbo") ||
    name.includes("claude-3") ||
    name.includes("gemini") ||
    name.includes("sonnet") ||
    name.includes("opus") ||
    name.includes("haiku");

  // Most modern models support tools; exceptions:
  // (Operator precedence made explicit with parentheses for clarity.)
  const noTools =
    name.includes("o1-mini") ||
    name.includes("o1-preview");
  // Note: previously `name.includes("instruct") && !name.includes("tool")`
  // was used to mark instruct models as tool-incapable, but most modern
  // instruct models (Llama-3.1-Instruct, Qwen2.5-Instruct, Mistral-Instruct,
  // etc.) DO support tools. Removed to stop mislabeling them.

  const supportsTools = !noTools;

  // Context window heuristics
  let contextWindow = 8192;
  if (name.includes("gpt-4o") || name.includes("gpt-4-turbo")) contextWindow = 128000;
  else if (name.includes("claude-3")) contextWindow = 200000;
  else if (name.includes("gemini-1.5") || name.includes("gemini-2")) contextWindow = 1000000;
  else if (name.includes("glm-4-long")) contextWindow = 1000000;
  else if (name.includes("glm-4")) contextWindow = 128000;
  else if (name.includes("llama-3.3") || name.includes("llama3.3")) contextWindow = 128000;
  else if (name.includes("llama-3.1") || name.includes("llama3.1")) contextWindow = 128000;
  else if (name.includes("llama-3") || name.includes("llama3")) contextWindow = 8192;
  else if (name.includes("qwen2.5") || name.includes("qwen-2.5")) contextWindow = 32768;
  else if (name.includes("mistral") || name.includes("mixtral")) contextWindow = 32768;
  else if (name.includes("deepseek")) contextWindow = 64000;
  else if (name.includes("phi-3") || name.includes("phi3")) contextWindow = 128000;

  // Description heuristics
  let description = "AI model";
  if (name.includes("gpt-4o")) description = "OpenAI multimodal model";
  else if (name.includes("gpt-4")) description = "OpenAI GPT-4 model";
  else if (name.includes("gpt-3.5")) description = "Fast OpenAI model";
  else if (name.includes("o1")) description = "OpenAI reasoning model";
  else if (name.includes("claude-3-5-sonnet") || name.includes("claude-3.5-sonnet")) description = "Anthropic Sonnet for real-world work";
  else if (name.includes("claude-3-5-haiku") || name.includes("claude-3.5-haiku")) description = "Fast Anthropic model";
  else if (name.includes("claude-3-opus") || name.includes("claude-3-opus")) description = "Anthropic flagship model";
  else if (name.includes("claude-3-haiku")) description = "Fastest Anthropic model";
  else if (name.includes("gemini")) description = "Google Gemini model";
  else if (name.includes("glm-4-plus")) description = "Z.ai flagship model";
  else if (name.includes("glm-4-air")) description = "Fast Z.ai model";
  else if (name.includes("glm-4-flash")) description = "Free Z.ai model";
  else if (name.includes("glm-4-long")) description = "Long-context Z.ai model";
  else if (name.includes("llama")) description = "Meta Llama model";
  else if (name.includes("qwen")) description = "Alibaba Qwen model";
  else if (name.includes("mistral")) description = "Mistral AI model";
  else if (name.includes("deepseek")) description = "DeepSeek model";
  else if (name.includes("phi")) description = "Microsoft Phi model";
  else if (name.includes("code")) description = "Code-optimized model";

  return { supportsTools, supportsVision, contextWindow, description };
}

// Make a display name from a model ID
function makeDisplayName(name: string): string {
  return name
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bGpt\b/g, "GPT")
    .replace(/\bClaude\b/g, "Claude")
    .replace(/\bGlm\b/g, "GLM")
    .replace(/\bAi\b/g, "AI")
    .trim();
}

// Fetch models from a provider's API
async function fetchModelsFromProvider(provider: {
  id: string;
  type: string;
  baseUrl: string;
  apiKey?: string | null;
}): Promise<FetchedModel[]> {
  const baseUrl = provider.baseUrl.replace(/\/$/, "");
  const headers: Record<string, string> = {};
  if (provider.apiKey) {
    headers["Authorization"] = `Bearer ${provider.apiKey}`;
    // Anthropic-specific headers — only send them to Anthropic.
    // Sending x-api-key / anthropic-version to OpenAI, Ollama, or LM Studio
    // is at best ignored and at worst causes some servers to reject the
    // request with a 400.
    if (provider.type === "anthropic") {
      headers["x-api-key"] = provider.apiKey;
      headers["anthropic-version"] = "2023-06-01";
    }
  }

  let models: Array<{ id?: string; name?: string }> = [];

  if (provider.type === "ollama") {
    // Ollama uses /api/tags
    try {
      const resp = await fetch(`${baseUrl.replace(/\/v1$/, "")}/api/tags`, {
        headers,
        signal: AbortSignal.timeout(10000),
      });
      if (resp.ok) {
        const data = await resp.json();
        models = (data.models || []).map((m: { name: string }) => ({
          name: m.name,
        }));
      }
    } catch {
      // fall through to /api/v1/models
    }
  }

  if (provider.type === "lmstudio" && models.length === 0) {
    // LM Studio REST API: GET /api/v1/models
    // Normalize base: strip any trailing /api/v1 or /v1 the user may have typed
    const lmsBase = baseUrl
      .replace(/\/api\/v1$/, "")
      .replace(/\/v1$/, "");
    try {
      const resp = await fetch(`${lmsBase}/api/v1/models`, {
        headers,
        signal: AbortSignal.timeout(10000),
      });
      if (resp.ok) {
        const data = await resp.json();
        // LM Studio returns { data: [{ id, object, ... }] }
        models = (data.data || data.models || []).map(
          (m: { id?: string; name?: string }) => ({ id: m.id || m.name })
        );
      }
    } catch {
      // ignore
    }
  }

  if (models.length === 0) {
    // Standard OpenAI-compatible /v1/models or /models
    const modelsUrl = provider.type === "anthropic"
      ? `${baseUrl}/v1/models`
      : `${baseUrl}/models`;
    try {
      const resp = await fetch(modelsUrl, {
        headers,
        signal: AbortSignal.timeout(10000),
      });
      if (resp.ok) {
        const data = await resp.json();
        models = data.data || data.models || [];
      }
    } catch {
      // ignore
    }
  }

  return models
    .filter((m) => m.id || m.name)
    .map((m) => {
      const name = m.id || m.name || "";
      const caps = detectCapabilities(name);
      return {
        name,
        displayName: makeDisplayName(name),
        contextWindow: caps.contextWindow,
        supportsTools: caps.supportsTools,
        supportsVision: caps.supportsVision,
        description: caps.description,
      };
    });
}

// Get models for a provider — uses cache if fresh, fetches otherwise
export async function getProviderModels(providerId: string): Promise<{
  models: FetchedModel[];
  fromCache: boolean;
  fetchedAt: Date | null;
}> {
  const provider = await db.provider.findUnique({ where: { id: providerId } });
  if (!provider) {
    return { models: [], fromCache: false, fetchedAt: null };
  }

  // Check cache
  const cached = await db.modelCache.findUnique({ where: { providerId } });
  const now = Date.now();
  if (cached && now - cached.fetchedAt.getTime() < CACHE_TTL_MS) {
    try {
      const models = JSON.parse(cached.models) as FetchedModel[];
      return { models, fromCache: true, fetchedAt: cached.fetchedAt };
    } catch {
      // cache corrupt, refetch
    }
  }

  // Fetch fresh
  try {
    const models = await fetchModelsFromProvider(provider);
    // Update cache
    await db.modelCache.upsert({
      where: { providerId },
      create: {
        providerId,
        models: JSON.stringify(models),
      },
      update: {
        models: JSON.stringify(models),
        fetchedAt: new Date(),
      },
    });
    // Also sync to the Model table so the rest of the app sees them
    await syncModelsToDb(providerId, models);
    return { models, fromCache: false, fetchedAt: new Date() };
  } catch (e) {
    // If fetch fails but we have stale cache, use it
    if (cached) {
      try {
        const models = JSON.parse(cached.models) as FetchedModel[];
        return { models, fromCache: true, fetchedAt: cached.fetchedAt };
      } catch {
        // ignore
      }
    }
    // Fall back to existing models in DB
    const existingModels = await db.model.findMany({
      where: { providerId },
    });
    return {
      models: existingModels.map((m) => ({
        name: m.name,
        displayName: m.displayName,
        contextWindow: m.contextWindow,
        supportsTools: m.supportsTools,
        supportsVision: m.supportsVision,
      })),
      fromCache: true,
      fetchedAt: cached?.fetchedAt || null,
    };
  }
}

// Sync fetched models to the Model table (add new, update existing, don't delete)
async function syncModelsToDb(providerId: string, models: FetchedModel[]) {
  const existing = await db.model.findMany({ where: { providerId } });
  const existingNames = new Set(existing.map((m) => m.name));

  for (const m of models) {
    if (existingNames.has(m.name)) {
      // Update capabilities
      await db.model.updateMany({
        where: { providerId, name: m.name },
        data: {
          displayName: m.displayName,
          contextWindow: m.contextWindow,
          supportsTools: m.supportsTools,
          supportsVision: m.supportsVision,
        },
      });
    } else {
      // Create new
      await db.model.create({
        data: {
          providerId,
          name: m.name,
          displayName: m.displayName,
          contextWindow: m.contextWindow,
          supportsTools: m.supportsTools,
          supportsVision: m.supportsVision,
          enabled: true,
        },
      });
    }
  }
}

// Force refresh all providers' model lists
export async function refreshAllProviderModels(): Promise<{
  refreshed: number;
  results: Array<{ providerId: string; providerName: string; modelCount: number; fromCache: boolean; error?: string }>;
}> {
  const providers = await db.provider.findMany({ where: { enabled: true } });
  const results = [];
  let refreshed = 0;

  for (const p of providers) {
    try {
      const { models, fromCache } = await getProviderModels(p.id);
      if (!fromCache) refreshed++;
      results.push({
        providerId: p.id,
        providerName: p.name,
        modelCount: models.length,
        fromCache,
      });
    } catch (e) {
      results.push({
        providerId: p.id,
        providerName: p.name,
        modelCount: 0,
        fromCache: false,
        error: (e as Error).message,
      });
    }
  }

  return { refreshed, results };
}
