// Provider adapter — translates between our unified format and provider-specific APIs.
// Supports: OpenAI-compatible (OpenAI, GLM, local), Anthropic, Ollama, LM Studio REST API.

import type {
  ChatMessage,
  ChatRequest,
  StreamChunk,
  ToolCall,
  ToolDefinition,
} from "./types";

export interface ProviderAdapter {
  streamChat(
    req: ChatRequest,
    provider: { baseUrl: string; apiKey?: string; isLocal?: boolean },
    signal?: AbortSignal
  ): AsyncGenerator<StreamChunk>;
}

// ---------- OpenAI-compatible adapter (OpenAI, GLM, local OpenAI servers) ----------
const openAIAdapter: ProviderAdapter = {
  async *streamChat(req, provider, signal) {
    const baseUrl = provider.baseUrl.replace(/\/$/, "");
    const url = `${baseUrl}/chat/completions`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    // Only send Authorization header for cloud providers with an API key
    // Local providers (Ollama, LM Studio) don't need auth
    if (provider.apiKey && !provider.isLocal) {
      headers["Authorization"] = `Bearer ${provider.apiKey}`;
    }

    const body: Record<string, unknown> = {
      model: req.modelId,
      messages: buildOpenAIMessages(req),
      stream: true,
      temperature: req.temperature ?? 0.7,
    };
    if (req.maxTokens) body.max_tokens = req.maxTokens;
    if (req.tools && req.tools.length > 0) {
      body.tools = req.tools;
      body.tool_choice = "auto";
    }

    const resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });

    if (!resp.ok || !resp.body) {
      const txt = await resp.text().catch(() => "");
      yield {
        type: "error",
        error: `Provider ${resp.status}: ${txt.slice(0, 500)}`,
      };
      return;
    }

    yield* parseOpenAIStream(resp.body);
  },
};

function buildOpenAIMessages(req: ChatRequest) {
  const out: Array<Record<string, unknown>> = [];
  if (req.systemPrompt) {
    out.push({ role: "system", content: req.systemPrompt });
  }
  for (const m of req.messages) {
    if (m.role === "tool") {
      out.push({
        role: "tool",
        tool_call_id: m.toolCallId,
        content: m.content,
      });
    } else if (m.role === "assistant" && m.toolCalls?.length) {
      out.push({
        role: "assistant",
        content: m.content || null,
        tool_calls: m.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        })),
      });
    } else {
      out.push({ role: m.role, content: m.content });
    }
  }
  return out;
}

async function* parseOpenAIStream(
  body: ReadableStream<Uint8Array>
): AsyncGenerator<StreamChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const toolCallAccumulators = new Map<
    number,
    { id: string; name: string; args: string }
  >();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") {
          // Flush any complete tool calls
          for (const [, tc] of toolCallAccumulators) {
            if (tc.name) {
              let parsedArgs: Record<string, unknown> = {};
              try {
                parsedArgs = tc.args ? JSON.parse(tc.args) : {};
              } catch {
                parsedArgs = { raw: tc.args };
              }
              yield {
                type: "tool_call",
                toolCall: { id: tc.id, name: tc.name, arguments: parsedArgs },
              };
            }
          }
          yield { type: "done" };
          return;
        }
        try {
          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta;
          if (!delta) continue;
          if (delta.content) {
            yield { type: "text", content: delta.content };
          }
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              const acc = toolCallAccumulators.get(idx) || {
                id: "",
                name: "",
                args: "",
              };
              if (tc.id) acc.id = tc.id;
              if (tc.function?.name) acc.name += tc.function.name;
              if (tc.function?.arguments) acc.args += tc.function.arguments;
              toolCallAccumulators.set(idx, acc);
            }
          }
        } catch {
          // skip malformed chunks
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  yield { type: "done" };
}

// ---------- Anthropic adapter ----------
const anthropicAdapter: ProviderAdapter = {
  async *streamChat(req, provider, signal) {
    const baseUrl = provider.baseUrl.replace(/\/$/, "");
    const url = `${baseUrl}/v1/messages`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
    };
    if (provider.apiKey) {
      headers["x-api-key"] = provider.apiKey;
    }

    const { system, messages } = buildAnthropicMessages(req);
    const body: Record<string, unknown> = {
      model: req.modelId,
      messages,
      stream: true,
      max_tokens: req.maxTokens ?? 4096,
    };
    if (system) body.system = system;
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.tools && req.tools.length > 0) {
      body.tools = req.tools.map((t) => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters,
      }));
    }

    const resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });

    if (!resp.ok || !resp.body) {
      const txt = await resp.text().catch(() => "");
      yield {
        type: "error",
        error: `Anthropic ${resp.status}: ${txt.slice(0, 500)}`,
      };
      return;
    }

    yield* parseAnthropicStream(resp.body);
  },
};

function buildAnthropicMessages(req: ChatRequest) {
  let system = req.systemPrompt || "";
  const messages: Array<Record<string, unknown>> = [];
  for (const m of req.messages) {
    if (m.role === "system") {
      system += (system ? "\n\n" : "") + m.content;
      continue;
    }
    if (m.role === "tool") {
      messages.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: m.toolCallId,
            content: m.content,
          },
        ],
      });
      continue;
    }
    if (m.role === "assistant" && m.toolCalls?.length) {
      const content: Array<Record<string, unknown>> = [];
      if (m.content) content.push({ type: "text", text: m.content });
      for (const tc of m.toolCalls) {
        content.push({
          type: "tool_use",
          id: tc.id,
          name: tc.name,
          input: tc.arguments,
        });
      }
      messages.push({ role: "assistant", content });
      continue;
    }
    messages.push({ role: m.role, content: m.content });
  }
  return { system, messages };
}

async function* parseAnthropicStream(
  body: ReadableStream<Uint8Array>
): AsyncGenerator<StreamChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        try {
          const json = JSON.parse(trimmed.slice(5).trim());
          if (json.type === "content_block_delta") {
            const delta = json.delta;
            if (delta?.type === "text_delta" && delta.text) {
              yield { type: "text", content: delta.text };
            } else if (delta?.type === "input_json_delta" && delta.partial_json) {
              // Tool input partial — accumulate, emit on stop
            }
          } else if (json.type === "content_block_start") {
            const block = json.content_block;
            if (block?.type === "tool_use") {
              yield {
                type: "tool_call",
                toolCall: {
                  id: block.id,
                  name: block.name,
                  arguments: block.input || {},
                },
              };
            }
          } else if (json.type === "message_stop") {
            yield { type: "done" };
            return;
          }
        } catch {
          // skip
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  yield { type: "done" };
}

// ---------- LM Studio REST API adapter (/api/v1/chat) ----------
// Reference: https://lmstudio.ai/docs/api/rest-api
//
// Key differences from OpenAI-compat:
//   - Endpoint: POST /api/v1/chat  (NOT /v1/chat/completions)
//   - Request:  { model, input: string, system_prompt, stream, temperature, max_output_tokens }
//   - Response: { model_instance_id, output: OutputItem[], stats, response_id }
//   - output items: { type: "message"|"tool_call"|"reasoning"|"invalid_tool_call", ... }
//
// input MUST be a plain string.
//   The array form of input uses type discriminators "text" | "image" only —
//   sending { type: "message", ... } in the array triggers:
//   "Invalid discriminator value. Expected 'text' | 'image'"
//
// Streaming: each SSE data chunk is a FULL SNAPSHOT of the response so far,
//   NOT a delta. We diff against the previously emitted length to yield only
//   the new suffix each time.
const lmstudioAdapter: ProviderAdapter = {
  async *streamChat(req, provider, signal) {
    // Normalise base URL — strip any trailing /v1 or /api/v1 the user may have typed
    const base = provider.baseUrl
      .replace(/\/$/, "")
      .replace(/\/api\/v1$/, "")
      .replace(/\/v1$/, "");
    const url = `${base}/api/v1/chat`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (provider.apiKey) {
      headers["Authorization"] = `Bearer ${provider.apiKey}`;
    }

    // ── Build input ────────────────────────────────────────────────────────────
    // LM Studio only accepts input as a plain string (the current user turn).
    // Multi-turn history is folded into system_prompt so the model has context.
    // (True stateful multi-turn via previous_response_id is a future improvement.)

    const nonSystemMessages = req.messages.filter((m) => m.role !== "system");
    const lastUserMsg = nonSystemMessages[nonSystemMessages.length - 1];

    // Render prior turns as labelled lines for injection into system_prompt
    const historyLines: string[] = [];
    for (const m of nonSystemMessages.slice(0, -1)) {
      if (m.role === "tool") {
        historyLines.push(
          `[Tool result for ${m.toolName || "tool"} (id: ${m.toolCallId})]:\n${m.content}`
        );
      } else if (m.role === "assistant" && m.toolCalls?.length) {
        if (m.content) historyLines.push(`Assistant: ${m.content}`);
        for (const tc of m.toolCalls) {
          historyLines.push(
            `[Tool call: ${tc.name}(${JSON.stringify(tc.arguments)})]`
          );
        }
      } else {
        const label = m.role === "assistant" ? "Assistant" : "User";
        historyLines.push(`${label}: ${m.content}`);
      }
    }

    const historyContext =
      historyLines.length > 0
        ? `\n\n--- Conversation history ---\n${historyLines.join("\n")}\n--- End of conversation history ---`
        : "";

    // Merge req.systemPrompt + system-role messages + history into one string
    const systemMessages = req.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const systemPrompt =
      [req.systemPrompt, systemMessages, historyContext]
        .filter(Boolean)
        .join("\n\n") || undefined;

    // input: plain string of the latest user message — no discriminator issues
    const input: string = lastUserMsg?.content ?? "";

    // ── Build request body ─────────────────────────────────────────────────────
    const body: Record<string, unknown> = {
      model: req.modelId,
      input,
      stream: true,
    };
    if (systemPrompt) body.system_prompt = systemPrompt;
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.maxTokens) body.max_output_tokens = req.maxTokens;

    // Note: LM Studio tool use goes via "integrations" (ephemeral MCP / plugin IDs),
    // not the OpenAI tools[] format. Our agent loop handles tool dispatch server-side
    // so we don't need to pass tool definitions here.

    const resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });

    if (!resp.ok || !resp.body) {
      const txt = await resp.text().catch(() => "");
      yield {
        type: "error",
        error: `LM Studio ${resp.status}: ${txt.slice(0, 500)}`,
      };
      return;
    }

    yield* parseLmStudioStream(resp.body);
  },
};

// Parse the LM Studio SSE stream.
//
// LM Studio streams CUMULATIVE SNAPSHOTS — each `data:` chunk contains the
// full output built up so far, not just the new tokens. For example:
//   chunk 1 → output[0].content = "Hello"
//   chunk 2 → output[0].content = "Hello world"
//   chunk 3 → output[0].content = "Hello world, how"
//   final   → output[0].content = "Hello world, how are you?" + stats field
//
// We track `emittedMessageLength` and yield only the NEW suffix each time,
// turning the snapshot stream into the delta stream the UI expects.
async function* parseLmStudioStream(
  body: ReadableStream<Uint8Array>
): AsyncGenerator<StreamChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  // How many characters of the message content we have already yielded
  let emittedMessageLength = 0;

  // Dedup tool calls by fingerprint — they appear fully-formed and repeat across chunks
  const emittedToolCallIds = new Set<string>();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") {
          yield { type: "done" };
          return;
        }
        try {
          const json = JSON.parse(data);
          const output: Array<Record<string, unknown>> = json.output || [];

          for (const item of output) {
            const itemType = item.type as string;

            if (itemType === "message") {
              // Each chunk has the FULL accumulated content — emit only the new suffix
              const fullContent = (item.content as string) || "";
              if (fullContent.length > emittedMessageLength) {
                const delta = fullContent.slice(emittedMessageLength);
                emittedMessageLength = fullContent.length;
                yield { type: "text", content: delta };
              }

            } else if (itemType === "reasoning") {
              // Skip reasoning traces silently for now
              // (could be surfaced as a thinking event in future)

            } else if (itemType === "tool_call") {
              const tool = (item.tool as string) || "";
              const args = (item.arguments as Record<string, unknown>) || {};
              const toolOutput = (item.output as string) || "";
              // Stable fingerprint to avoid re-emitting on repeated chunks
              const callId = `lms-${tool}-${JSON.stringify(args).slice(0, 40)}`;

              if (!emittedToolCallIds.has(callId)) {
                emittedToolCallIds.add(callId);
                const tc: ToolCall = { id: callId, name: tool, arguments: args };
                yield { type: "tool_call", toolCall: tc };
                // LM Studio already executed the tool — its output is returned inline
                if (toolOutput) {
                  yield {
                    type: "tool_result",
                    toolResult: { toolCallId: callId, name: tool, content: toolOutput },
                  };
                }
              }

            } else if (itemType === "invalid_tool_call") {
              const reason = (item.reason as string) || "Invalid tool call";
              yield { type: "error", error: `LM Studio invalid tool call: ${reason}` };
            }
          }

          // Final chunk always includes a `stats` field
          if (json.stats) {
            yield { type: "done" };
            return;
          }
        } catch {
          // skip malformed / partial chunks
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  yield { type: "done" };
}

// ---------- Provider registry ----------
export const adapters: Record<string, ProviderAdapter> = {
  openai: openAIAdapter,
  glm: openAIAdapter,
  ollama: openAIAdapter,
  lmstudio: lmstudioAdapter,
  custom: openAIAdapter,
  anthropic: anthropicAdapter,
};

export function getAdapter(type: string): ProviderAdapter {
  return adapters[type] || openAIAdapter;
}
