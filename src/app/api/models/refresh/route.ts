import { NextResponse } from "next/server";
import { refreshAllProviderModels } from "@/lib/model-fetcher";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Force refresh all provider model lists (fetches from each provider's API)
export async function POST() {
  const result = await refreshAllProviderModels();
  return NextResponse.json(result);
}
