import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getProviderModels } from "@/lib/model-fetcher";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// List providers + their models + favorites
// If ?refresh=1 is set, fetch fresh models from each provider (bypassing 24h cache)
export async function GET(req: NextRequest) {
  const refresh = req.nextUrl.searchParams.get("refresh") === "1";
  const providers = await db.provider.findMany({
    include: { models: true },
    orderBy: { createdAt: "asc" },
  });
  const favorites = await db.favoriteModel.findMany();

  // If refresh requested, fetch fresh models for each enabled provider
  if (refresh) {
    for (const p of providers.filter((p) => p.enabled)) {
      try {
        await getProviderModels(p.id);
      } catch {
        // ignore errors, fall back to DB models
      }
    }
    // Re-fetch with updated models
    const refreshedProviders = await db.provider.findMany({
      include: { models: true },
      orderBy: { createdAt: "asc" },
    });
    return NextResponse.json({
      providers: refreshedProviders,
      favorites,
    });
  }

  return NextResponse.json({ providers, favorites });
}

interface ProviderBody {
  name: string;
  type: string;
  baseUrl: string;
  apiKey?: string;
  isLocal?: boolean;
  enabled?: boolean;
  models?: Array<{
    name: string;
    displayName: string;
    contextWindow?: number;
    supportsTools?: boolean;
    supportsVision?: boolean;
  }>;
}

// Create provider with optional models
export async function POST(req: NextRequest) {
  const body = (await req.json()) as ProviderBody;
  if (!body.name || !body.type || !body.baseUrl) {
    return NextResponse.json(
      { error: "name, type, baseUrl are required" },
      { status: 400 }
    );
  }
  const provider = await db.provider.create({
    data: {
      name: body.name,
      type: body.type,
      baseUrl: body.baseUrl,
      apiKey: body.apiKey || null,
      isLocal: body.isLocal ?? false,
      enabled: body.enabled ?? true,
      models: body.models?.length
        ? {
            create: body.models.map((m) => ({
              name: m.name,
              displayName: m.displayName,
              contextWindow: m.contextWindow ?? 8192,
              supportsTools: m.supportsTools ?? true,
              supportsVision: m.supportsVision ?? false,
            })),
          }
        : undefined,
    },
    include: { models: true },
  });
  return NextResponse.json({ provider });
}
