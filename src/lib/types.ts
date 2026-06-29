// Core type definitions for the chat platform

export type Role = "user" | "assistant" | "system" | "tool";

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  toolName?: string;
  status?: "streaming" | "complete" | "error";
  createdAt: string;
  // Thinking/reasoning trace events for this assistant message
  thinking?: ThinkingEvent[];
  // Ordered content blocks for interleaved rendering (text + tool calls)
  blocks?: ContentBlock[];
  // IDs of files attached to this user message
  attachments?: string[];
}

export interface ThinkingEvent {
  id: string;
  type: "thinking" | "tool_call" | "tool_result";
  // For thinking: the text content
  // For tool_call: tool name + args
  // For tool_result: tool name + result preview
  content?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: string;
  timestamp: string;
  status?: "active" | "complete" | "error";
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  name: string;
  content: string;
  isError?: boolean;
}

export type ProviderType =
  | "openai"
  | "anthropic"
  | "glm"
  | "ollama"
  | "lmstudio"
  | "openrouter"
  | "custom";

export interface ProviderConfig {
  id: string;
  name: string;
  type: ProviderType;
  baseUrl: string;
  apiKey?: string;
  enabled: boolean;
  isLocal: boolean;
}

export interface ModelConfig {
  id: string;
  providerId: string;
  name: string;
  displayName: string;
  contextWindow: number;
  supportsTools: boolean;
  supportsVision: boolean;
}

export interface ChatRequest {
  messages: ChatMessage[];
  providerId: string;
  modelId: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: ToolDefinition[];
  stream?: boolean;
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface StreamChunk {
  type: "text" | "thinking" | "tool_call" | "tool_result" | "done" | "error" | "step";
  content?: string;
  toolCall?: ToolCall;
  toolResult?: ToolResult;
  error?: string;
  step?: string;
}

/**
 * An ordered content block for interleaved rendering of text + tool calls.
 * Stored in the Message.blocks column as a JSON array.
 */
export interface ContentBlock {
  type: "text" | "tool_call" | "tool_result" | "thinking";
  content?: string;       // for text/thinking blocks
  toolCall?: ToolCall;    // for tool_call blocks
  toolResult?: ToolResult; // for tool_result blocks
  timestamp: string;
  status?: "active" | "complete" | "error";
}
