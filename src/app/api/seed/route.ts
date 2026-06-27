import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getProviderModels } from "@/lib/model-fetcher";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Seed default providers.
//
// IDEMPOTENT: upserts each provider by name. If a provider with the same name
// already exists, it is left untouched (we don't overwrite the user's API key
// or model list). Missing providers are added. This means re-running the seed
// after adding new defaults (e.g. OpenRouter) will add the new ones without
// wiping existing configuration.
//
// Pre-populates: OpenAI, Anthropic, GLM, OpenRouter, Ollama (local), LM Studio (local)
// For local providers, immediately probes for available models.
export async function POST() {
  const seedProviders = [
    {
      name: "OpenAI",
      type: "openai" as const,
      baseUrl: "https://api.openai.com/v1",
      isLocal: false,
      seedModels: [
        { name: "gpt-4o", displayName: "GPT-4o", contextWindow: 128000, supportsVision: true },
        { name: "gpt-4o-mini", displayName: "GPT-4o mini", contextWindow: 128000, supportsVision: true },
        { name: "gpt-4-turbo", displayName: "GPT-4 Turbo", contextWindow: 128000, supportsVision: true },
        { name: "o1-mini", displayName: "o1-mini", contextWindow: 128000, supportsTools: false },
      ],
    },
    {
      name: "Anthropic",
      type: "anthropic" as const,
      baseUrl: "https://api.anthropic.com",
      isLocal: false,
      seedModels: [
        { name: "claude-3-5-sonnet-20241022", displayName: "Claude 3.5 Sonnet", contextWindow: 200000, supportsVision: true },
        { name: "claude-3-5-haiku-20241022", displayName: "Claude 3.5 Haiku", contextWindow: 200000, supportsVision: true },
        { name: "claude-3-opus-20240229", displayName: "Claude 3 Opus", contextWindow: 200000, supportsVision: true },
      ],
    },
    {
      name: "Z.ai GLM",
      type: "glm" as const,
      baseUrl: "https://open.bigmodel.cn/api/paas/v4",
      isLocal: false,
      seedModels: [
        { name: "glm-4-plus", displayName: "GLM-4-Plus", contextWindow: 128000 },
        { name: "glm-4-air", displayName: "GLM-4-Air", contextWindow: 128000 },
        { name: "glm-4-airx", displayName: "GLM-4-AirX", contextWindow: 8192 },
        { name: "glm-4-long", displayName: "GLM-4-Long", contextWindow: 1000000 },
        { name: "glm-4-flash", displayName: "GLM-4-Flash", contextWindow: 128000 },
      ],
    },
    {
      name: "OpenRouter",
      type: "openrouter" as const,
      baseUrl: "https://openrouter.ai/api/v1",
      isLocal: false,
      // No seed models — OpenRouter's catalog is huge and changes frequently.
      // The user adds an API key in Settings, then clicks "Refresh models" to
      // fetch the live list from https://openrouter.ai/api/v1/models.
      seedModels: [],
    },
    {
      name: "Ollama (Local)",
      type: "ollama" as const,
      baseUrl: "http://localhost:11434/v1",
      isLocal: true,
      seedModels: [],
    },
    {
      name: "LM Studio (Local)",
      type: "lmstudio" as const,
      baseUrl: "http://localhost:1234/v1",
      isLocal: true,
      seedModels: [],
    },
  ];

  // Build a set of existing provider names so we only insert missing ones.
  const existing = await db.provider.findMany({ select: { name: true } });
  const existingNames = new Set(existing.map((p) => p.name));

  const added: string[] = [];
  const skipped: string[] = [];

  for (const p of seedProviders) {
    if (existingNames.has(p.name)) {
      skipped.push(p.name);
      continue;
    }

    const created = await db.provider.create({
      data: {
        name: p.name,
        type: p.type,
        baseUrl: p.baseUrl,
        isLocal: p.isLocal,
        apiKey: null,
        enabled: true,
        models: p.seedModels.length
          ? { create: p.seedModels }
          : undefined,
      },
    });
    added.push(p.name);

    // For local providers, immediately probe for available models
    if (p.isLocal) {
      try {
        await getProviderModels(created.id);
      } catch {
        // local server might not be running — that's OK
      }
    }
  }

  return NextResponse.json({
    seeded: added.length > 0,
    added,
    skipped,
    message: added.length > 0
      ? `Added ${added.length} provider(s): ${added.join(", ")}`
      : "All default providers already exist",
  });
}
