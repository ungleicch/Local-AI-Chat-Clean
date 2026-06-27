import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getProviderModels } from "@/lib/model-fetcher";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Seed default providers (only if none exist).
// Pre-populates: OpenAI, Anthropic, GLM, Ollama (local), LM Studio (local)
// For local providers, immediately probes for available models.
export async function POST() {
  const existing = await db.provider.count();
  if (existing > 0) {
    return NextResponse.json({ seeded: false, message: "Providers already exist" });
  }

  const seedProviders = [
    {
      name: "OpenAI",
      type: "openai",
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
      type: "anthropic",
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
      type: "glm",
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
      name: "Ollama (Local)",
      type: "ollama",
      baseUrl: "http://localhost:11434/v1",
      isLocal: true,
      seedModels: [],
    },
    {
      name: "LM Studio (Local)",
      type: "lmstudio",
      baseUrl: "http://localhost:1234/v1",
      isLocal: true,
      seedModels: [],
    },
  ];

  for (const p of seedProviders) {
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

    // For local providers, immediately probe for available models
    if (p.isLocal) {
      try {
        await getProviderModels(created.id);
      } catch {
        // local server might not be running — that's OK
      }
    }
  }

  return NextResponse.json({ seeded: true, count: seedProviders.length });
}
