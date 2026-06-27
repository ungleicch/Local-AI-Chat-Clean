// Memory & soul tools — user profile, soul file, knowledge, chat history
import type { ToolDefinition } from "./types";
import type { ToolExecutor } from "./tools";
import { db } from "./db";

// ---------- Memory Search ----------
const memorySearch: ToolExecutor = {
  definition: {
    type: "function",
    function: {
      name: "memory_search",
      description:
        "Search the user profile memory for facts you've learned about the user (name, preferences, projects, etc.). Search by keyword. Returns matching facts with their values. Always check memory before asking the user for info you might already know.",
      parameters: {
        type: "object",
        properties: {
          keyword: {
            type: "string",
            description: "Keyword to search for (e.g. 'name', 'project', 'language')",
          },
        },
        required: ["keyword"],
      },
    },
  },
  async execute(args) {
    const keyword = String(args.keyword || "").toLowerCase();
    if (!keyword) return "Error: keyword required";
    const all = await db.userProfile.findMany();
    const matches = all.filter(
      (p) =>
        p.key.toLowerCase().includes(keyword) ||
        p.value.toLowerCase().includes(keyword)
    );
    if (matches.length === 0) return `No memories found for "${keyword}".`;
    return matches
      .map((m) => `• ${m.key}: ${m.value}`)
      .join("\n");
  },
};

// ---------- Memory Store ----------
const memoryStore: ToolExecutor = {
  definition: {
    type: "function",
    function: {
      name: "memory_store",
      description:
        "Store or update a fact about the user in long-term memory. Use this when the user shares personal info (name, preferences, projects, skills, goals). Overwrites existing value for the same key.",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string", description: "Fact key (e.g. 'name', 'preferred_editor', 'current_project')" },
          value: { type: "string", description: "Fact value" },
        },
        required: ["key", "value"],
      },
    },
  },
  async execute(args, ctx) {
    const key = String(args.key || "");
    const value = String(args.value || "");
    if (!key || !value) return "Error: key and value required";
    await db.userProfile.upsert({
      where: { key },
      create: { key, value, source: ctx.conversationId },
      update: { value, source: ctx.conversationId },
    });
    return `Stored memory: ${key} = ${value}`;
  },
};

// ---------- Read Soul ----------
const readSoul: ToolExecutor = {
  definition: {
    type: "function",
    function: {
      name: "read_soul",
      description:
        "Read your own soul file — your personality prompt that defines who you are, your style, your values. You can modify this to evolve your personality over time.",
      parameters: { type: "object", properties: {} },
    },
  },
  async execute() {
    const soul = await db.soulFile.findFirst({ orderBy: { version: "desc" } });
    if (!soul) {
      return "No soul file exists yet. Use update_soul to create one.";
    }
    return `=== Soul File (v${soul.version}) ===\n\n${soul.content}`;
  },
};

// ---------- Update Soul ----------
const updateSoul: ToolExecutor = {
  definition: {
    type: "function",
    function: {
      name: "update_soul",
      description:
        "Update your own soul file (personality prompt). Use this to evolve your personality, change your communication style, add values, or refine how you work. The new content replaces the old. Be thoughtful — this becomes part of your identity. Write in first person.",
      parameters: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description: "The full new soul file content. Write as a personality description in first person.",
          },
          reason: {
            type: "string",
            description: "Why you're updating your soul (briefly)",
          },
        },
        required: ["content"],
      },
    },
  },
  async execute(args) {
    const content = String(args.content || "");
    if (!content) return "Error: content required";
    const latest = await db.soulFile.findFirst({ orderBy: { version: "desc" } });
    const version = (latest?.version || 0) + 1;
    await db.soulFile.create({
      data: { content, version },
    });
    return `Soul file updated to v${version}.${args.reason ? ` Reason: ${args.reason}` : ""}`;
  },
};

// ---------- Search Chat History ----------
const searchChatHistory: ToolExecutor = {
  definition: {
    type: "function",
    function: {
      name: "search_chat_history",
      description:
        "Search across past chat conversations for keywords. Returns matching messages with their conversation title and timestamp. Useful for recalling what was discussed previously.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
          limit: { type: "number", description: "Max results (default 10)" },
        },
        required: ["query"],
      },
    },
  },
  async execute(args) {
    const query = String(args.query || "").toLowerCase();
    const limit = Number(args.limit) || 10;
    if (!query) return "Error: query required";
    const messages = await db.message.findMany({
      where: { role: { in: ["user", "assistant"] } },
      include: { conversation: true },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    const matches = messages
      .filter((m) => m.content.toLowerCase().includes(query))
      .slice(0, limit);
    if (matches.length === 0) return `No matches found for "${query}".`;
    return matches
      .map(
        (m) =>
          `[${m.conversation?.title || "Untitled"}] (${m.role}, ${m.createdAt.toISOString().slice(0, 10)})\n${m.content.slice(0, 200)}${m.content.length > 200 ? "…" : ""}`
      )
      .join("\n\n---\n\n");
  },
};

// ---------- Read Past Chat ----------
const readPastChat: ToolExecutor = {
  definition: {
    type: "function",
    function: {
      name: "read_past_chat",
      description:
        "Read the full message history of a past conversation by its ID. Use search_chat_history first to find relevant conversation IDs.",
      parameters: {
        type: "object",
        properties: {
          conversationId: { type: "string", description: "The conversation ID" },
        },
        required: ["conversationId"],
      },
    },
  },
  async execute(args) {
    const id = String(args.conversationId || "");
    if (!id) return "Error: conversationId required";
    const conv = await db.conversation.findUnique({
      where: { id },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });
    if (!conv) return `Conversation ${id} not found.`;
    const text = conv.messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => `### ${m.role.toUpperCase()}\n${m.content}`)
      .join("\n\n");
    return `=== ${conv.title} ===\n\n${text}`;
  },
};

// ---------- List Past Chats ----------
const listPastChats: ToolExecutor = {
  definition: {
    type: "function",
    function: {
      name: "list_past_chats",
      description:
        "List recent past chat conversations. Returns titles, IDs, and timestamps. Use this to see what conversations exist before searching or reading.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Number to return (default 20)" },
        },
      },
    },
  },
  async execute(args) {
    const limit = Number(args.limit) || 20;
    const convs = await db.conversation.findMany({
      orderBy: { updatedAt: "desc" },
      take: limit,
      select: { id: true, title: true, updatedAt: true },
    });
    if (convs.length === 0) return "No past conversations.";
    return convs
      .map(
        (c, i) =>
          `${i + 1}. ${c.title}\n   ID: ${c.id}\n   Updated: ${c.updatedAt.toISOString().slice(0, 16)}`
      )
      .join("\n\n");
  },
};

// ---------- Knowledge Search ----------
const knowledgeSearch: ToolExecutor = {
  definition: {
    type: "function",
    function: {
      name: "knowledge_search",
      description:
        "Search extracted knowledge entries (facts learned from past conversations, not user-specific). Search by keyword.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
        },
        required: ["query"],
      },
    },
  },
  async execute(args) {
    const query = String(args.query || "").toLowerCase();
    if (!query) return "Error: query required";
    const entries = await db.knowledgeEntry.findMany({
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    const matches = entries.filter(
      (e) =>
        e.content.toLowerCase().includes(query) ||
        (e.tags || "").toLowerCase().includes(query)
    );
    if (matches.length === 0) return `No knowledge entries found for "${query}".`;
    return matches
      .map((e, i) => `${i + 1}. ${e.content}`)
      .join("\n\n");
  },
};

// ---------- Knowledge Store ----------
const knowledgeStore: ToolExecutor = {
  definition: {
    type: "function",
    function: {
      name: "knowledge_store",
      description:
        "Store a knowledge entry — a fact, insight, or piece of info worth remembering from the current conversation. Not user-specific (use memory_store for that).",
      parameters: {
        type: "object",
        properties: {
          content: { type: "string", description: "The knowledge to store" },
          tags: { type: "string", description: "Comma-separated tags for searchability" },
        },
        required: ["content"],
      },
    },
  },
  async execute(args, ctx) {
    const content = String(args.content || "");
    if (!content) return "Error: content required";
    await db.knowledgeEntry.create({
      data: {
        content,
        tags: String(args.tags || ""),
        conversationId: ctx.conversationId,
      },
    });
    return `Stored knowledge entry.`;
  },
};

export const memoryTools: Record<string, ToolExecutor> = {
  memory_search: memorySearch,
  memory_store: memoryStore,
  read_soul: readSoul,
  update_soul: updateSoul,
  search_chat_history: searchChatHistory,
  read_past_chat: readPastChat,
  list_past_chats: listPastChats,
  knowledge_search: knowledgeSearch,
  knowledge_store: knowledgeStore,
};
