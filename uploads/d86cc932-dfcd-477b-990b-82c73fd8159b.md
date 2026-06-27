# LocalAI Studio — Installation Guide for Mac

A private, minimal AI chat platform with autonomous agent loops, memory, soul file, virtual environments, and multi-provider support. Runs entirely on your machine.

---

## Quick Start (5 minutes)

### Step 1: Install Prerequisites

You need **Node.js** and **Bun** (or npm) installed on your Mac.

#### Option A: Using Homebrew (recommended)

```bash
# Install Homebrew if you don't have it
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install Node.js
brew install node

# Install Bun (faster, recommended)
brew install oven-sh/bun/bun
```

#### Option B: Direct download

- Node.js: https://nodejs.org/ (download the LTS version)
- Bun: `curl -fsSL https://bun.sh/install | bash`

### Step 2: Unzip the Project

```bash
# Move the zip to your preferred location
mv ~/Downloads/localai-studio.zip ~/Projects/

# Navigate there
cd ~/Projects/

# Unzip
unzip localai-studio.zip -d localai-studio

# Enter the project directory
cd localai-studio
```

### Step 3: Install Dependencies

```bash
# Using Bun (recommended — faster)
bun install

# OR using npm (if you don't have Bun)
npm install
```

### Step 4: Set Up the Database

The app uses SQLite (no separate database server needed). The database file is created automatically on first run. Just push the schema:

```bash
# Using Bun
bun run db:push

# OR using npm
npx prisma db push
```

### Step 5: Start the Development Server

```bash
# Using Bun
bun run dev

# OR using npm
npm run dev
```

### Step 6: Open the App

Open your browser and go to:

```
http://localhost:3000
```

---

## First-Time Setup

### 1. Add AI Providers

1. Hover the **left edge** of the screen to reveal the sidebar
2. Click the **gear icon** (Settings) in the top-right of the sidebar
3. In the **Providers** tab, click **"Add Defaults"**
4. This seeds 5 providers: OpenAI, Anthropic, Z.ai GLM, Ollama (local), LM Studio (local)
5. Click **"Edit"** on any cloud provider (OpenAI, Anthropic, GLM) and paste your **API key**
6. Click **Save**

#### Where to get API keys:
- **OpenAI**: https://platform.openai.com/api-keys
- **Anthropic**: https://console.anthropic.com/settings/keys
- **Z.ai GLM**: https://open.bigmodel.cn/usercenter/apikeys

### 2. (Optional) Set Up Local Models

#### Ollama (free, runs on your Mac):
```bash
# Install Ollama
brew install ollama

# Start the Ollama server
ollama serve

# In another terminal, pull a model
ollama pull llama3.2
```

Then in Settings → Providers → Ollama → click **"Probe"** to auto-detect models.

#### LM Studio:
1. Download from https://lmstudio.ai
2. Load any model in LM Studio
3. Start the local server (Developer tab)
4. In Settings → Providers → LM Studio → click **"Probe"**

### 3. Start Chatting

1. Close Settings
2. The input bar is centered in the middle of the screen
3. Type a message and press **Enter**
4. The AI responds with streaming text

---

## Features

### Keyboard Shortcuts
- **⌘T** (Cmd+T): New chat
- **⌘S** (Cmd+S): Stop AI stream
- **Enter**: Send message
- **Shift+Enter**: New line in message

### Mouse Gestures
- **Hover left edge**: Reveal conversation sidebar
- **Hover left of input bar**: Reveal model picker + attach button
- **Scroll up twice at top**: Navigate to previous (newer) chat
- **Scroll down twice at bottom**: Navigate to next (older) chat

### AI Tools (all autonomous — the AI decides when to use them)
- **Web Search**: Search the web via DuckDuckGo
- **Web Fetch**: Read content from any URL
- **Code Execution**: Run JavaScript in a sandbox
- **Calculator**: Safe math expression evaluator
- **File Operations**: Read, write, list files in workspace
- **Memory**: Store and search user facts (`memory_store`, `memory_search`)
- **Soul File**: Read and update its own personality (`read_soul`, `update_soul`)
- **Chat History**: Search and read past conversations
- **Knowledge**: Store and search general knowledge entries
- **Virtual Environments**: Create isolated sandboxes for building/running code
- **System Files**: Read files on your Mac, write with automatic backups
- **Custom Tools**: The AI can create new tools for itself
- **Image Generation**: Generate images and embed them in responses
- **File Extraction**: Extract text from PDFs, images (OCR), documents

### Model Picker
- Click the invisible button to the left of the input bar (hover to reveal)
- Search models by name
- Filter by provider using the icon tabs
- Star models to add to Favorites
- Click the **(i)** icon for model details and thinking mode selector

### Settings (5 tabs)
1. **Providers**: Add/edit/delete AI providers, API keys, model auto-detection
2. **Agent**: System prompt, temperature, max tokens, max agent steps
3. **Soul**: Edit the AI's self-modifiable personality prompt
4. **Memory**: View and delete user profile facts and knowledge entries
5. **Files**: View pending file changes, accept or restore

---

## Project Structure

```
localai-studio/
├── src/
│   ├── app/
│   │   ├── api/              # Backend API routes
│   │   │   ├── chat/         # SSE streaming + agent loop
│   │   │   ├── providers/    # Provider CRUD + model probe
│   │   │   ├── conversations/# Conversation + message CRUD
│   │   │   ├── upload/       # File upload
│   │   │   ├── files/        # Serve uploaded/generated files
│   │   │   ├── soul/         # Soul file CRUD
│   │   │   ├── memory/       # User profile + knowledge
│   │   │   ├── favorites/    # Favorite models
│   │   │   ├── models/       # Model refresh
│   │   │   ├── changes/      # Pending file changes
│   │   │   └── seed/         # One-click default seeding
│   │   ├── page.tsx          # Main chat UI
│   ├── components/
│   │   ├── chat/             # Sidebar, composer, model picker, messages
│   │   └── settings/         # Settings dialog
│   ├── lib/
│   │   ├── types.ts          # Shared types
│   │   ├── providers.ts      # Provider adapters (OpenAI/Anthropic)
│   │   ├── tools.ts          # Built-in tool registry
│   │   ├── tools-memory.ts   # Memory & soul tools
│   │   ├── tools-env.ts      # Virtual environment tools
│   │   ├── tools-system.ts   # Safe system file tools
│   │   ├── tools-files.ts    # File extraction tools
│   │   ├── tools-image.ts    # Image generation tool
│   │   ├── agent.ts          # Agent loop engine
│   │   ├── model-fetcher.ts  # Dynamic model fetching (24h cache)
│   │   └── stores/           # Zustand state stores
│   └── hooks/                # Custom React hooks
├── prisma/
│   └── schema.prisma         # Database schema
├── package.json
└── next.config.ts
```

---

## Troubleshooting

### "Cannot find module" errors
Run `bun install` (or `npm install`) again to make sure all dependencies are installed.

### Database errors
Delete the `db/` folder and run `bun run db:push` again:
```bash
rm -rf db/
bun run db:push
```

### Port 3000 already in use
Change the port in `package.json`:
```json
"dev": "next dev -p 3001"
```

### Local models not detected
Make sure Ollama or LM Studio is running:
- Ollama: `ollama serve` in a terminal
- LM Studio: Start the local server in the app

Then click "Probe" in Settings → Providers.

### API key not working
Make sure you're using the correct key format:
- OpenAI: starts with `sk-`
- Anthropic: starts with `sk-ant-`
- GLM: get from https://open.bigmodel.cn

---

## Production Build (optional)

For a production build:

```bash
# Build
bun run build

# Start production server
bun run start
```

---

## Privacy

- All conversations stored locally in SQLite (`db/custom.db`)
- API keys stored locally, only sent to the configured provider
- No telemetry, no third-party analytics
- Web search goes directly to DuckDuckGo
- Code execution runs in a restricted VM sandbox
- Virtual environments are isolated directories
- File modifications always backed up until you accept them

---

## Tech Stack

- **Framework**: Next.js 16 (App Router) + TypeScript 5
- **UI**: Tailwind CSS 4 + shadcn/ui + Framer Motion
- **Database**: Prisma ORM + SQLite
- **State**: Zustand with persist middleware
- **Streaming**: Server-Sent Events (SSE)
- **Agent**: Custom multi-step loop with tool calling
- **LaTeX**: KaTeX
- **Code execution**: Node.js `vm` sandbox
- **File extraction**: pdftotext, tesseract OCR

---

Enjoy your private AI workspace! 🚀
