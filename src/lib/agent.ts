// src/lib/agent.ts
// Agent loop engine — orchestrates multi-step reasoning with tool use.
// Streams events: assistant text → tool calls → tool results → next assistant turn → ...

import type {
  ChatMessage,
  StreamChunk,
  ToolCall,
  ToolDefinition,
  ToolResult,
} from "./types";
import { getAdapter } from "./providers";
import { executeTool, getToolDefinitions, refreshCustomTools } from "./tools";
import { STREAM_INJECT_TOOLS } from "./tools-stream";
import { db } from "./db";

export interface AgentLoopOptions {
  providerId: string;
  providerType: string;
  providerBaseUrl: string;
  providerApiKey?: string;
  providerIsLocal?: boolean;
  modelId: string;
  modelSupportsTools: boolean;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  maxSteps?: number;
  enabledTools?: string[];
  workDir: string;
  conversationId: string;
  signal?: AbortSignal;
  history: ChatMessage[]; // prior conversation messages (not including the new user turn)
}

// Build a dynamic system prompt that includes soul file, user profile, and custom tool list
async function buildDynamicSystemPrompt(basePrompt?: string): Promise<string> {
  const parts: string[] = [];

  // Soul file (agent's self-defined personality)
  const soul = await db.soulFile.findFirst({ orderBy: { version: "desc" } });
  if (soul) {
    parts.push(`=== YOUR SOUL (your self-defined personality) ===\n${soul.content}\n`);
  }

  // Base system prompt
  if (basePrompt) {
    parts.push(basePrompt);
  }

  // User profile memory
  const userProfile = await db.userProfile.findMany({ take: 50 });
  if (userProfile.length > 0) {
    parts.push(
      `=== WHAT YOU KNOW ABOUT THE USER ===\n${userProfile
        .map((p) => `• ${p.key}: ${p.value}`)
        .join("\n")}\n\nUse memory_search to look up more. Use memory_store when the user shares new info.`
    );
  } else {
    parts.push(
      "No user memories yet. Use memory_store when the user shares personal info (name, preferences, projects)."
    );
  }

  // Custom tools the agent has created
  const customTools = await db.customTool.findMany({ where: { enabled: true } });
  if (customTools.length > 0) {
    parts.push(
      `=== YOUR CUSTOM TOOLS ===\nYou have created these tools for yourself:\n${customTools
        .map((t) => `• ${t.name}: ${t.description}`)
        .join("\n")}`
    );
  }

  parts.push(
    "=== GUIDELINES ===\n" +
    "• You have web_search, web_fetch, and get_tools always available. For any other capability, call get_tools with a description of the task you want to perform, and the relevant tools will be added to your available set.\n" +
    "• For anything that needs current info, use web_search. For deeper reading of a specific page, use web_fetch.\n" +
    "• When you need to calculate, write code, read/write files, use memory, create virtual environments, generate images, or any other task — call get_tools first to request those tools.\n" +
    "• For building/compiling/running risky commands, ALWAYS create a virtual env first (request via get_tools), run inside it, then copy the result out. Never run build commands directly on the host.\n" +
    "• For reading files the user references, request read_system_file via get_tools. For modifying files, request write_system_file (it auto-backs-up) or edit_file for find/replace edits.\n" +
    "• When the user uploads files, request extract_file via get_tools to read their contents. Supports PDFs, images (OCR), Office docs, spreadsheets, presentations, audio, video, and more.\n" +
    "• You can create new tools with create_tool (request via get_tools) if you find yourself needing a capability you don't have.\n" +
    "• You can evolve your own personality with update_soul (request via get_tools).\n" +
    "• Be concise. Think step by step. Always explain what you're doing briefly before calling tools.\n" +
    "\n" +
    "=== RICH CONTENT TOOLS (always available — no need to request via get_tools) ===\n" +
    "• **create_table** — Call this to create a formatted table in your response. Provide 'headers' (array of column names) and 'rows' (array of row arrays). The table is injected into your response INSTANTLY — you do NOT need to write the markdown yourself. Example: call create_table with headers=[\"Name\",\"Score\"], rows=[[\"Alice\",\"95\"],[\"Bob\",\"87\"]] and the table appears immediately.\n" +
    "• **embed_image** — Call this to embed an image into your response. THREE modes:\n" +
    "    - **query**: pass query=\"a banana\" to FIND an image on the web and embed it. Use this when the user says 'find me an image of X', 'show me a picture of X', or 'find an image'. DO NOT use generate_image for 'find' requests — use embed_image with query instead.\n" +
    "    - **url**: pass url=\"https://...\" to embed a specific image URL.\n" +
    "    - **file_id**: pass file_id to embed a previously uploaded/generated file.\n" +
    "  The image appears INSTANTLY. It is downloaded and served locally so it won't break.\n" +
    "• **generate_image** — Call this to GENERATE a new AI image from a text prompt (e.g. 'a sunset over mountains'). Use this ONLY when the user explicitly wants to CREATE/GENERATE new art, not when they want to FIND an existing image. The image appears INSTANTLY after generation.\n" +
    "• **embed_youtube** — Call this to embed a YouTube video. Pass a YouTube URL (watch?v=, youtu.be, /embed/, /shorts/) or a bare 11-char video ID. The video appears as a responsive iframe player INSTANTLY. Use this when the user shares a YouTube link or asks to embed a video.\n" +
    "• **embed_video** — Call this to embed a direct video file URL (mp4, webm, ogg) as an HTML5 video player. Use this for direct video links (NOT YouTube — use embed_youtube for those).\n" +
    "• **embed_audio** — Call this to embed a direct audio file URL (mp3, wav, ogg) as an HTML5 audio player.\n" +
    "• **embed_link_preview** — Call this to render a rich link preview card (with title, description, and image) for any URL. Use this when the user shares a link and you want a nice preview rather than a plain hyperlink.\n" +
    "• When you call these tools, the content is added to your response automatically. Do NOT repeat the table/image/video markdown in your next message — just continue with any additional commentary or explanation.\n" +
    "• These tools make your responses richer and more visual. Use them whenever the user's request would benefit from a table, image, video, or link preview — don't just describe data in text when you can show it."
  );

  return parts.join("\n\n");
}

export async function* runAgentLoop(
  opts: AgentLoopOptions
): AsyncGenerator<StreamChunk> {
  const adapter = getAdapter(opts.providerType);
  const maxSteps = opts.maxSteps ?? 8;

  // Refresh custom tools cache so newly-created tools are available
  await refreshCustomTools();

  // Build dynamic system prompt with soul + memory
  const dynamicSystemPrompt = await buildDynamicSystemPrompt(opts.systemPrompt);

  // Tools currently available to the model — starts with the always-bound set.
  // Stream-injectable tools (create_table, embed_image, generate_image,
  // embed_youtube, embed_video, embed_audio, embed_link_preview) are always
  // available so the model can produce rich content immediately without
  // needing to request them via get_tools first.
  const allToolDefs = getToolDefinitions(undefined); // all tools
  const alwaysBoundToolNames = new Set([
    "web_search",
    "web_fetch",
    "get_tools",
    "create_table",
    "embed_image",
    "generate_image",
    "embed_youtube",
    "embed_video",
    "embed_audio",
    "embed_link_preview",
  ]);

  // Tools currently available to the model — starts with just web_search + get_tools
  let availableTools: ToolDefinition[] = opts.modelSupportsTools
    ? allToolDefs.filter((t) => alwaysBoundToolNames.has(t.function.name))
    : [];

  // Helper: get tool definitions by names
  const getToolsByNames = (names: string[]): ToolDefinition[] => {
    return allToolDefs.filter((t) => names.includes(t.function.name));
  };

  // Local working copy of messages we'll mutate as we go
  const messages: ChatMessage[] = [...opts.history];

  for (let step = 0; step < maxSteps; step++) {
    yield { type: "step", step: `Step ${step + 1}` };

    // Call the model
    const req = {
      messages,
      providerId: opts.providerId,
      modelId: opts.modelId,
      systemPrompt: dynamicSystemPrompt,
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
      tools: availableTools,
      stream: true,
    };

    let textBuffer = "";
    const toolCalls: ToolCall[] = [];
    // Some adapters (notably LM Studio's REST adapter if it is ever used)
    // execute tools server-side and return the result inline as a
    // `tool_result` chunk. We collect these so we don't try to re-execute
    // the same tool below.
    const precomputedResults = new Map<string, ToolResult>();

    try {
      for await (const chunk of adapter.streamChat(
        req,
        { baseUrl: opts.providerBaseUrl, apiKey: opts.providerApiKey, isLocal: opts.providerIsLocal },
        opts.signal
      )) {
        if (opts.signal?.aborted) {
          yield { type: "done" };
          return;
        }
        if (chunk.type === "text" && chunk.content) {
          textBuffer += chunk.content;
          yield chunk;
        } else if (chunk.type === "thinking" && chunk.content) {
          // Reasoning content — pass through directly to the route handler.
          // It gets sent as a separate SSE event type and routed to the
          // thinking indicator, NOT the response text.
          yield chunk;
        } else if (chunk.type === "tool_call" && chunk.toolCall) {
          toolCalls.push(chunk.toolCall);
        } else if (chunk.type === "tool_result" && chunk.toolResult) {
          // Adapter already executed this tool — record the result so we
          // don't re-execute it below.
          precomputedResults.set(chunk.toolResult.toolCallId, chunk.toolResult);
        } else if (chunk.type === "error") {
          yield chunk;
          return;
        } else if (chunk.type === "done") {
          break;
        }
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        yield { type: "done" };
        return;
      }
      yield { type: "error", error: `Provider error: ${(e as Error).message}` };
      return;
    }

    // Append the assistant message to history
    const assistantMsg: ChatMessage = {
      id: `asst-${Date.now()}-${step}`,
      role: "assistant",
      content: textBuffer,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      status: "complete",
      createdAt: new Date().toISOString(),
    };
    messages.push(assistantMsg);

    // If there are no tool calls, we're done
    if (toolCalls.length === 0) {
      yield { type: "done" };
      return;
    }

    // Execute each tool call and emit events
    for (const tc of toolCalls) {
      // Special handling for get_tools — dynamically adds tools to available set
      if (tc.name === "get_tools") {
        yield { type: "tool_call", toolCall: tc };
        const requestedTasks = String(tc.arguments.task || tc.arguments.description || "").toLowerCase();
        // Match tools based on task description keywords
        const toolKeywords: Record<string, string[]> = {
          web_fetch: ["fetch", "url", "website", "page", "read url", "web page"],
          image_search: ["image search", "find image", "search images", "image results", "pictures"],
          news_search: ["news", "current events", "breaking", "recent articles", "headlines"],
          wikipedia_search: ["wikipedia", "encyclopedia", "wiki"],
          wikipedia_read: ["read wikipedia", "wikipedia article", "wiki article"],
          execute_code: ["code", "javascript", "script", "run", "program", "function"],
          calculate: ["math", "calculate", "computation", "arithmetic", "equation", "formula"],
          read_file: ["read file", "file content", "open file", "workspace file"],
          write_file: ["write file", "create file", "save file", "workspace"],
          edit_file: ["edit file", "modify file", "find replace", "patch file", "change in file"],
          append_file: ["append file", "add to file", "append to"],
          create_directory: ["create directory", "make folder", "mkdir", "new folder"],
          delete_file: ["delete file", "remove file", "rm file"],
          move_file: ["move file", "rename file", "mv file"],
          copy_file: ["copy file", "duplicate file", "cp file"],
          list_files: ["list files", "directory", "files in", "browse"],
          memory_search: ["memory", "remember", "user profile", "facts about user"],
          memory_store: ["store memory", "save fact", "remember about user"],
          read_soul: ["soul", "personality", "my identity"],
          update_soul: ["update soul", "change personality", "evolve"],
          search_chat_history: ["chat history", "past conversation", "previous chat"],
          read_past_chat: ["read past chat", "past conversation"],
          list_past_chats: ["list chats", "past conversations"],
          knowledge_search: ["knowledge", "facts", "learned"],
          knowledge_store: ["store knowledge", "save fact"],
          create_env: ["virtual env", "sandbox", "isolated", "build", "compile"],
          run_in_env: ["run command", "shell", "execute command", "terminal"],
          copy_from_env: ["copy from env", "extract artifact"],
          kill_env: ["kill env", "destroy env", "cleanup env"],
          list_envs: ["list envs", "virtual environments"],
          write_env_file: ["write env file", "file in env"],
          read_env_file: ["read env file"],
          find_files: ["find files", "search files", "locate file"],
          read_system_file: ["read system file", "read file from system", "open file"],
          write_system_file: ["write system file", "modify file", "edit file", "change file"],
          list_pending_changes: ["pending changes", "file changes", "backups"],
          restore_file: ["restore file", "undo change", "revert"],
          create_tool: ["create tool", "new tool", "custom tool"],
          list_custom_tools: ["list custom tools", "my tools"],
          delete_custom_tool: ["delete tool", "remove tool"],
          extract_file: ["extract file", "pdf", "image text", "ocr", "document", "docx", "xlsx", "spreadsheet", "presentation"],
          list_uploaded_files: ["uploaded files", "attachments"],
          generate_image: ["generate image", "create image", "picture", "draw", "image"],
          create_table: ["table", "tabular", "grid", "spreadsheet", "columns and rows"],
          embed_image: ["embed image", "show image", "display image", "insert image", "picture in response"],
          embed_youtube: ["youtube", "embed video", "yt video", "video link"],
          embed_video: ["embed video file", "mp4", "webm", "video url"],
          embed_audio: ["embed audio", "mp3", "audio player", "audio url"],
          embed_link_preview: ["link preview", "card preview", "url preview", "og card"],
        };
        const matchedToolNames = new Set<string>();
        for (const [toolName, keywords] of Object.entries(toolKeywords)) {
          if (keywords.some((kw) => requestedTasks.includes(kw))) {
            matchedToolNames.add(toolName);
          }
        }
        // Also allow explicit tool names in the request
        const allToolNames = allToolDefs.map((t) => t.function.name);
        for (const name of allToolNames) {
          if (requestedTasks.includes(name)) {
            matchedToolNames.add(name);
          }
        }
        // Add matched tools to available set
        const newTools = getToolsByNames(Array.from(matchedToolNames));
        const existingNames = new Set(availableTools.map((t) => t.function.name));
        for (const t of newTools) {
          if (!existingNames.has(t.function.name)) {
            availableTools.push(t);
            existingNames.add(t.function.name);
          }
        }
        const addedNames = newTools.map((t) => t.function.name).filter((n) => !alwaysBoundToolNames.has(n));
        const resultContent = addedNames.length > 0
          ? `Added ${addedNames.length} tool(s) to your available tools: ${addedNames.join(", ")}. You can now call these tools.`
          : "No matching tools found for that task. Available tool categories: web, code, math, files, memory, soul, history, knowledge, virtual environments, system files, custom tools, file extraction, image generation.";
        const result: ToolResult = {
          toolCallId: tc.id,
          name: tc.name,
          content: resultContent,
        };
        yield { type: "tool_result", toolResult: result };
        messages.push({
          id: `tool-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          role: "tool",
          content: resultContent,
          toolCallId: tc.id,
          toolName: tc.name,
          status: "complete",
          createdAt: new Date().toISOString(),
        });
        continue;
      }

      yield { type: "tool_call", toolCall: tc };
      // If the adapter already executed this tool server-side, reuse its
      // result instead of calling executeTool again.
      const precomputed = precomputedResults.get(tc.id);
      const result: ToolResult = precomputed ?? {
        toolCallId: tc.id,
        name: tc.name,
        content: await executeTool(
          tc.name,
          tc.arguments,
          {
            conversationId: opts.conversationId,
            signal: opts.signal,
            workDir: opts.workDir,
          }
        ),
      };

      // Stream-injectable tools: their result IS markdown content (tables,
      // images, videos, etc.) that should appear in the response stream
      // immediately — without waiting for the model to re-generate it in the
      // next step. We yield the result content as a text chunk so it flows
      // into the response instantly, then yield the tool_result for the
      // thinking indicator, and tell the model not to repeat the content.
      // Only inject if the result looks like valid markdown, NOT if it's an
      // error message.
      const isError = /^Error:/i.test(result.content) ||
        /^Image generation error:/i.test(result.content) ||
        /^Search error:/i.test(result.content) ||
        /^Fetch error:/i.test(result.content) ||
        /^PDF extraction failed:/i.test(result.content) ||
        /^Could not /i.test(result.content);
      if (STREAM_INJECT_TOOLS.has(tc.name) && !isError) {
        // Inject the markdown into the stream as text
        yield { type: "text", content: "\n\n" + result.content + "\n\n" };
        // Override the tool result message so the model knows it's already injected
        result.content =
          `[ALREADY INJECTED INTO YOUR RESPONSE — do not repeat this markdown:]\n${result.content}\n[END INJECTED CONTENT]\n` +
          `The above content has been added to your response. Continue with any additional commentary or explanation. Do NOT repeat the table/image markdown.`;
      }

      yield { type: "tool_result", toolResult: result };
      messages.push({
        id: `tool-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        role: "tool",
        content: result.content,
        toolCallId: tc.id,
        toolName: tc.name,
        status: "complete",
        createdAt: new Date().toISOString(),
      });
    }
  }

  yield {
    type: "text",
    content: "\n\n_(Reached maximum reasoning steps. Providing final answer.)_",
  };
  yield { type: "done" };
}
