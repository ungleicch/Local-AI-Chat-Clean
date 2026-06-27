// Provider adapter — translates between our unified format and provider-specific APIs.
// Supports: OpenAI-compatible (OpenAI, GLM, local), Anthropic, Ollama, LM Studio.
//
// LM Studio is routed through the OpenAI-compatible adapter
// (`POST {base}/v1/chat/completions`) because LM Studio's `/v1` endpoint is
// fully OpenAI-compatible, supports proper multi-turn message history, tool
// calls, and token-by-token delta streaming. The legacy REST adapter
// (`/api/v1/chat`) folded all history into a single system_prompt string,
// which broke multi-turn quality and tool dispatch.

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

// ---------- OpenAI-compatible adapter (OpenAI, GLM, local OpenAI servers, LM Studio) ----------

// Normalize a provider base URL so that it ends with `/v1`.
//
// Handles the common variations users type:
//   http://localhost:1234          → http://localhost:1234/v1
//   http://localhost:1234/         → http://localhost:1234/v1
//   http://localhost:1234/v1       → http://localhost:1234/v1   (no-op)
//   http://localhost:1234/v1/      → http://localhost:1234/v1
//   https://api.openai.com         → https://api.openai.com/v1
//   https://api.openai.com/v1      → https://api.openai.com/v1  (no-op)
//   http://localhost:11434/api     → http://localhost:11434/api/v1  (Ollama OpenAI-compat path kept)
//
// Without this, a base URL like `http://localhost:1234` produces
// `POST /chat/completions` which LM Studio does not route — it logs
// "Unexpected endpoint or method (POST /chat/completions)" and returns
// an empty 200, which the client sees as a successful but empty stream.
function normalizeOpenAIBaseUrl(raw: string): string {
  const base = raw.replace(/\/+$/, "");
  // If the URL already ends with /v1 (or /vN for any digit), leave it alone.
  if (/\/v\d+$/.test(base)) return base;
  // Ollama exposes an OpenAI-compatible API under /api — keep that path.
  if (/\/api$/.test(base)) return `${base}/v1`;
  return `${base}/v1`;
}

const openAIAdapter: ProviderAdapter = {
  async *streamChat(req, provider, signal) {
    const baseUrl = normalizeOpenAIBaseUrl(provider.baseUrl);
    const url = `${baseUrl}/chat/completions`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    // Only send Authorization header for cloud providers with an API key.
    // Local providers (Ollama, LM Studio, local OpenAI-compatible servers)
    // typically don't need auth, and sending a stale Bearer token can cause
    // some servers to reject the request.
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

// Parse the OpenAI-compatible SSE stream.
//
// Handles three delta fields that providers emit:
//   - `delta.content`               — normal text (OpenAI, GLM, LM Studio, etc.)
//   - `delta.reasoning_content`     — reasoning trace (DeepSeek, QwQ via LM Studio,
//                                     OpenAI-compatible servers exposing reasoning)
//   - `delta.tool_calls`            — streamed tool-call function name + args
//
// Reasoning content is yielded as a separate `thinking` chunk type so the
// agent loop / chat route can route it directly to the thinking indicator —
// it NEVER appears in the main response text. This avoids the janky UX of
// thinking text flashing in the response area before being moved to the
// thinking box.
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
  // State for parsing <think>...</think> tags from delta.content.
  // Many models (Gemma, DeepSeek, QwQ) emit reasoning as <think> tags
  // INSIDE delta.content rather than as delta.reasoning_content.
  // We parse these out and yield them as 'thinking' chunks so they go
  // directly to the thinking indicator, not the response text.
  let thinkBuffer = "";      // accumulates text to scan for <think> tags
  let insideThink = false;   // whether we're currently inside a <think> block

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
          // Flush any remaining thinkBuffer content
          if (thinkBuffer) {
            if (insideThink) {
              yield { type: "thinking", content: thinkBuffer };
            } else {
              yield { type: "text", content: thinkBuffer };
            }
            thinkBuffer = "";
            insideThink = false;
          }
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

          // Normal text content — parse out <think>...</think> tags.
          // Many models emit reasoning as <think> tags inside delta.content
          // instead of using delta.reasoning_content. We split these out:
          // text outside <think> tags → 'text' chunks
          // text inside <think> tags → 'thinking' chunks
          if (typeof delta.content === "string" && delta.content) {
            thinkBuffer += delta.content;
            // Process the buffer, extracting complete <think> blocks and
            // yielding text/thinking chunks. We only yield text that we're
            // sure is NOT inside a <think> block.
            while (thinkBuffer.length > 0) {
              if (!insideThink) {
                // Look for opening <think> tag
                const openIdx = thinkBuffer.indexOf("<think>");
                if (openIdx === -1) {
                  // No <think> tag found. But we might be in the middle of
                  // one (e.g. "<thi" so far). Hold back the last few chars
                  // to avoid splitting a partial tag, yield the rest as text.
                  if (thinkBuffer.length > 7) {
                    const safe = thinkBuffer.slice(0, thinkBuffer.length - 7);
                    thinkBuffer = thinkBuffer.slice(thinkBuffer.length - 7);
                    if (safe) yield { type: "text", content: safe };
                  }
                  break;
                } else {
                  // Yield text before <think> as a text chunk
                  if (openIdx > 0) {
                    yield { type: "text", content: thinkBuffer.slice(0, openIdx) };
                  }
                  thinkBuffer = thinkBuffer.slice(openIdx + 7); // skip "<think>"
                  insideThink = true;
                }
              } else {
                // Inside <think> block — look for closing </think> tag
                const closeIdx = thinkBuffer.indexOf("</think>");
                if (closeIdx === -1) {
                  // No closing tag yet. Yield everything as thinking, but
                  // hold back 8 chars in case "</think>" is split across chunks.
                  if (thinkBuffer.length > 8) {
                    const safe = thinkBuffer.slice(0, thinkBuffer.length - 8);
                    thinkBuffer = thinkBuffer.slice(thinkBuffer.length - 8);
                    if (safe) yield { type: "thinking", content: safe };
                  }
                  break;
                } else {
                  // Yield thinking content before </think>
                  if (closeIdx > 0) {
                    yield { type: "thinking", content: thinkBuffer.slice(0, closeIdx) };
                  }
                  thinkBuffer = thinkBuffer.slice(closeIdx + 8); // skip "</think>"
                  insideThink = false;
                }
              }
            }
          }

          // Reasoning content (delta.reasoning_content) — yield as thinking.
          // This is a separate field used by DeepSeek API and some LM Studio
          // models. Models that emit <think> tags in delta.content are handled
          // by the parser above.
          if (
            typeof delta.reasoning_content === "string" &&
            delta.reasoning_content
          ) {
            yield { type: "thinking", content: delta.reasoning_content };
          }

          // Tool calls — accumulate function name + args, flush on [DONE]
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
  // Stream ended without [DONE] — flush remaining thinkBuffer + tool calls.
  if (thinkBuffer) {
    if (insideThink) {
      yield { type: "thinking", content: thinkBuffer };
    } else {
      yield { type: "text", content: thinkBuffer };
    }
  }
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

// Parse the Anthropic SSE stream.
//
// Anthropic streams tool-call arguments via `input_json_delta` events — each
// event carries a partial JSON fragment. We accumulate these per content-block
// index and only yield the tool_call once the block closes
// (`content_block_stop`), at which point we parse the accumulated JSON.
async function* parseAnthropicStream(
  body: ReadableStream<Uint8Array>
): AsyncGenerator<StreamChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  // Per-block accumulator: block index -> { id, name, argsBuffer }
  const toolInputBuffers = new Map<
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
        if (!trimmed.startsWith("data:")) continue;
        try {
          const json = JSON.parse(trimmed.slice(5).trim());
          if (json.type === "content_block_start") {
            const block = json.content_block;
            const idx: number = json.index ?? 0;
            if (block?.type === "tool_use") {
              // Register the tool-use block — arguments arrive later via
              // input_json_delta events on the same index.
              toolInputBuffers.set(idx, {
                id: block.id,
                name: block.name,
                args: "",
              });
            }
          } else if (json.type === "content_block_delta") {
            const delta = json.delta;
            const idx: number = json.index ?? 0;
            if (delta?.type === "text_delta" && delta.text) {
              yield { type: "text", content: delta.text };
            } else if (delta?.type === "input_json_delta" && delta.partial_json) {
              // Accumulate partial JSON for this tool-use block
              const acc = toolInputBuffers.get(idx);
              if (acc) acc.args += delta.partial_json;
            }
          } else if (json.type === "content_block_stop") {
            const idx: number = json.index ?? 0;
            const acc = toolInputBuffers.get(idx);
            if (acc) {
              // Parse the accumulated JSON and emit the tool call
              let parsedArgs: Record<string, unknown> = {};
              if (acc.args) {
                try {
                  parsedArgs = JSON.parse(acc.args);
                } catch {
                  parsedArgs = { raw: acc.args };
                }
              }
              yield {
                type: "tool_call",
                toolCall: {
                  id: acc.id,
                  name: acc.name,
                  arguments: parsedArgs,
                },
              };
              toolInputBuffers.delete(idx);
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

// ---------- Provider registry ----------
// LM Studio is routed through the OpenAI-compatible adapter because LM
// Studio's `/v1/chat/completions` endpoint is fully OpenAI-compatible and
// supports proper multi-turn message history, tool calls, and delta
// streaming. The previous REST adapter (`/api/v1/chat`) folded all history
// into a flat system_prompt string, which degraded multi-turn quality and
// broke the agent's tool dispatch.
export const adapters: Record<string, ProviderAdapter> = {
  openai: openAIAdapter,
  glm: openAIAdapter,
  ollama: openAIAdapter,
  lmstudio: openAIAdapter,
  openrouter: openAIAdapter,
  custom: openAIAdapter,
  anthropic: anthropicAdapter,
};

export function getAdapter(type: string): ProviderAdapter {
  return adapters[type] || openAIAdapter;
}
