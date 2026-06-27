import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Probe a local model server (Ollama or LM Studio) to list available models.
// Body: { type: "ollama" | "lmstudio", baseUrl: string }
export async function POST(req: NextRequest) {
  const body = await req.json();
  const type: string = body.type;
  const baseUrl: string = (body.baseUrl || "").replace(/\/$/, "");

  if (!baseUrl) {
    return NextResponse.json({ error: "baseUrl required" }, { status: 400 });
  }

  try {
    if (type === "ollama") {
      const resp = await fetch(`${baseUrl}/api/tags`, { signal: req.signal });
      if (!resp.ok) {
        return NextResponse.json(
          { error: `Ollama responded ${resp.status}` },
          { status: 502 }
        );
      }
      const data = await resp.json();
      const models = (data.models || []).map(
        (m: { name: string; details?: { parameter_size?: string } }) => ({
          name: m.name,
          displayName: m.name,
          supportsTools: true,
          supportsVision: m.name.toLowerCase().includes("llava") || m.name.toLowerCase().includes("vision"),
          contextWindow: 8192,
        })
      );
      return NextResponse.json({ models });
    }

    if (type === "lmstudio") {
      const resp = await fetch(`${baseUrl}/v1/models`, { signal: req.signal });
      if (!resp.ok) {
        return NextResponse.json(
          { error: `LM Studio responded ${resp.status}` },
          { status: 502 }
        );
      }
      const data = await resp.json();
      const models = (data.data || []).map(
        (m: { id: string }) => ({
          name: m.id,
          displayName: m.id,
          supportsTools: true,
          supportsVision: false,
          contextWindow: 8192,
        })
      );
      return NextResponse.json({ models });
    }

    // Generic OpenAI-compatible
    const resp = await fetch(`${baseUrl}/v1/models`, { signal: req.signal });
    if (!resp.ok) {
      return NextResponse.json(
        { error: `Server responded ${resp.status}` },
        { status: 502 }
      );
    }
    const data = await resp.json();
    const models = (data.data || []).map(
      (m: { id: string }) => ({
        name: m.id,
        displayName: m.id,
        supportsTools: true,
        supportsVision: false,
        contextWindow: 8192,
      })
    );
    return NextResponse.json({ models });
  } catch (e) {
    return NextResponse.json(
      { error: `Connection failed: ${(e as Error).message}` },
      { status: 502 }
    );
  }
}
