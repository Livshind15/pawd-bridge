# Pawd Bridge

**Self-hosted AI agent server for the [Pawd](https://pawd.space) mobile app.**

Pawd Bridge is a lightweight Fastify server that runs on your hardware and connects the Pawd iOS app to Claude via the [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk). It manages multi-agent conversations, task tracking, cron-scheduled heartbeats, webhooks, and real-time SSE streaming — with no external database.

---

## Features

- **Multi-agent conversations** — Single, broadcast, and multi-agent chat modes with fire-and-forget agent execution
- **Claude Agent SDK** — Runs agents directly via the SDK with OAuth or API key authentication
- **Agent workspaces** — Per-agent personality files (IDENTITY.md, SOUL.md, HEARTBEAT.md, MEMORY.md) and skills
- **Device pairing** — HMAC-SHA256 token authentication with QR code pairing flow
- **Conversation persistence** — Markdown frontmatter + JSONL message storage per conversation
- **Task management** — Create, assign, and track tasks with periodic state-change detection
- **Cron scheduler** — Built-in 5-field cron with per-agent heartbeat jobs
- **Webhooks** — Inbound webhook triggers with optional HMAC validation and template rendering
- **SSE event stream** — Real-time events with 200-event ring buffer for reconnect replay
- **Terminal** — Execute shell commands on the server from the mobile app
- **Filesystem** — Browse, read, write, upload, and download files
- **Nginx integration** — One-command reverse proxy setup with SSL
- **CLI tool** — `pawd` command to install, start, stop, and monitor the bridge

---

## Architecture

```
+------------------+                        +-------------------+
|   Pawd Mobile    |  <---  HTTP/SSE  --->  |   Pawd Bridge     |
|   (iOS)          |                        |   (Fastify:3001)  |
+------------------+                        +--------+----------+
                                                     |
                                            Claude Agent SDK
                                                     |
                                            +--------v----------+
                                            |   Claude API       |
                                            |   (Anthropic)      |
                                            +--------------------+
```

The bridge is the only server you run. It talks directly to the Claude API through the Agent SDK — there is no separate gateway process.

---

## Quick Start

### Prerequisites

- **Node.js** >= 18
- **Claude Code CLI** installed (`claude --version` to verify)
- An **Anthropic API key** or **Claude OAuth token**

### One-command install

```bash
curl -fsSL pawd.space/install.sh | bash -s -- --token YOUR_TOKEN
```

### Manual install

```bash
git clone https://github.com/AiPawd/pawd-bridge.git
cd pawd-bridge

npm install

# Set your credentials
echo 'CLAUDE_CODE_OAUTH_TOKEN=your-oauth-token' > ~/.pawd-bridge/.env
# or: echo 'ANTHROPIC_API_KEY=sk-ant-...' > ~/.pawd-bridge/.env

# Build & start
cd apps/bridge
npm run build
npm start
```

The bridge starts on `http://localhost:3001`.

### Using the CLI

```bash
cd apps/cli
npm install && npm run build
npm link

pawd install                    # Build + Nginx setup
pawd start                      # Start as daemon
pawd status                     # Health dashboard
pawd pair                       # QR code for mobile pairing
```

---

## Configuration

All configuration is via environment variables. The bridge reads from `~/.pawd-bridge/.env` on startup (process env vars take precedence).

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | HTTP server port |
| `DATA_DIR` | `~/.pawd-bridge/data` | Persistent data directory |
| `CLAUDE_CODE_OAUTH_TOKEN` | — | Claude subscription OAuth token (preferred) |
| `ANTHROPIC_API_KEY` | — | Direct Anthropic API key (fallback) |
| `AGENT_WORKSPACES_DIR` | `~/.pawd-bridge/workspaces` | Root of per-agent SDK workspaces |
| `DEFAULT_MODEL` | `claude-sonnet-4-20250514` | Default Claude model for agents |
| `OPENAI_API_KEY` | — | Required only for audio transcription (Whisper) |

---

## How It Works

### Agent execution

When a user sends a message, the bridge:

1. Persists the user message to the conversation store
2. Calls `runAgent()` — fire-and-forget, returns `{ streaming: true }` immediately
3. The SDK runs a multi-turn conversation loop with Claude
4. Each SDK event (assistant message, tool call, result) is translated to a `StreamEvent` and broadcast via the SSE event bus
5. On completion, the agent's final response is parsed and persisted as a `ChatMessage`
6. A `message.complete` event is broadcast so connected clients can update

### Agent workspaces

Each agent gets an isolated workspace directory:

```
~/.pawd-bridge/workspaces/{agentId}/
├── .claude/
│   ├── settings.json          # Claude Code workspace settings
│   └── skills/                # Installed agent skills
├── IDENTITY.md                # Name, role, personality
├── HEARTBEAT.md               # Periodic check-in instructions
├── SOUL.md                    # Values and behavior guidelines
├── USER.md                    # User context
├── TOOLS.md                   # Tool descriptions
├── BOOTSTRAP.md               # Startup tasks
├── MEMORY.md                  # Long-term memory
└── memory/
    └── {timestamp}-memory.md  # Timestamped memory logs
```

When an agent is created or updated, the bridge regenerates its personality files (IDENTITY.md, HEARTBEAT.md, SOUL.md) from the agent metadata.

### Cron scheduler

The built-in cron system runs on a 30-second tick:

- Supports standard 5-field cron expressions (`minute hour dayOfMonth month dayOfWeek`)
- Each agent gets a default heartbeat job at `*/30 * * * *` (every 30 minutes)
- Jobs trigger `runAgent()` with the job payload — fire-and-forget
- Run history is persisted to disk

### Task sync

Every 60 seconds the bridge scans task state and detects transitions:

- `todo → in_progress` → broadcasts `task.started`
- `* → done` → broadcasts `task.completed`, updates agent stats and token accounting
- Step changes → broadcasts `task.progress`

### SSE event stream

The `/api/events` endpoint provides real-time updates:

- Ring buffer of 200 events for reconnect replay (`?lastSeq=N`)
- Conversation-scoped filtering (`?conversationId=xxx`)
- 30-second heartbeat keepalive

---

## Device Authentication

Pawd Bridge uses **HMAC-SHA256** token authentication:

1. On first startup, the bridge generates a 64-byte HMAC key (`~/.pawd-bridge/data/auth/bridge-secret.json`) and a 32-character hex pairing secret (`~/.pawd-bridge/data/auth/pairing-secret.json`)
2. A mobile device pairs by presenting the pairing secret (via QR code scan) → receives a signed token
3. Tokens are `<base64url-payload>.<base64url-signature>` with 1-year expiry
4. All `/api/` requests require `Authorization: Bearer <token>` (except public endpoints)
5. **Bootstrapping mode**: if no devices are registered yet, all requests are allowed without auth
6. All auth files are written with mode `0600` and validated with constant-time comparison

---

## CLI Reference

| Command | Description |
|---------|-------------|
| `pawd install` | Build bridge + configure Nginx (flags: `--skip-nginx`, `--skip-build`, `--domain`) |
| `pawd start` | Start as background daemon (flags: `--port`, `--foreground`) |
| `pawd stop` | Stop running daemon via PID file |
| `pawd status` | Health dashboard — bridge process, port, Nginx |
| `pawd logs` | Tail bridge logs (flags: `--lines`, `--no-follow`) |
| `pawd pair` | Display pairing URL + QR code |
| `pawd dev` | Development mode with `tsx watch` hot reload (flags: `--port`) |

---

## API Reference

### Public Endpoints (No Auth)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Liveness probe |
| `GET` | `/api/status` | Uptime, SDK auth status, agent/task/cron counts |
| `GET` | `/api/events` | SSE event stream (supports `?lastSeq`, `?conversationId`) |
| `GET` | `/pair` | HTML pairing page with QR code |
| `GET` | `/api/devices/pair-info` | Pairing info JSON (`bridgeUrl`, `pairingSecret`) |
| `POST` | `/api/devices/pair` | Register device (rate-limited: 5/min) |

### Agents

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/agents` | List all agents |
| `GET` | `/api/agents/:id` | Get agent details |
| `POST` | `/api/agents` | Create agent + workspace + heartbeat cron |
| `PUT` | `/api/agents/:id` | Update agent + regenerate personality files |
| `DELETE` | `/api/agents/:id` | Delete agent + workspace + cron jobs |
| `GET` | `/api/agents/:id/skills` | List skills from `.claude/skills/` |
| `GET` | `/api/agents/:id/tools` | List agent tools |
| `GET` | `/api/agents/:id/workspace-path` | Get filesystem path to workspace |
| `POST` | `/api/agents/sync` | Manual sync trigger |
| `GET` | `/api/agents/:id/files` | List personality files |
| `PUT` | `/api/agents/:id/files/:name` | Write personality file (optimistic concurrency) |
| `GET` | `/api/agents/:id/memory-logs` | List timestamped memory logs |
| `GET` | `/api/agents/:id/memory-logs/:file` | Read specific memory log |

### Chat & Conversations

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/conversations` | List conversations (filter by `?agentId`) |
| `POST` | `/api/conversations` | Create conversation (single/broadcast/multi-agent) |
| `PATCH` | `/api/conversations/:id` | Rename conversation |
| `GET` | `/api/conversations/:id` | Get conversation + messages |
| `DELETE` | `/api/conversations/:id` | Delete conversation + SDK sessions |
| `POST` | `/api/conversations/:id/messages` | Send message → triggers agent execution |
| `POST` | `/api/conversations/:id/abort` | Cancel in-progress agent runs |
| `GET` | `/api/conversations/:id/messages` | Get messages (with pagination) |

### Tasks

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/tasks` | List tasks (filter by `?status`, `?agentId`, `?priority`) |
| `GET` | `/api/tasks/:id` | Get task |
| `POST` | `/api/tasks` | Create task (requires `assignedAgentId`) |
| `PUT` | `/api/tasks/:id` | Update task |
| `DELETE` | `/api/tasks/:id` | Delete task |
| `GET` | `/api/tasks/:id/output` | Get task output |

### Cron

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/cron` | Cron config + per-agent heartbeat status |
| `GET` | `/api/cron/jobs` | List all cron jobs |
| `POST` | `/api/cron/jobs` | Create cron job |
| `PUT` | `/api/cron/jobs/:id` | Update cron job |
| `DELETE` | `/api/cron/jobs/:id` | Delete cron job |
| `POST` | `/api/cron/jobs/:id/run` | Trigger immediate run |
| `GET` | `/api/cron/runs` | Recent run history |
| `GET` | `/api/cron/status` | Overall cron system status |
| `GET` | `/api/cron/:agentId/heartbeat` | Get HEARTBEAT.md content |
| `POST` | `/api/cron/setup-defaults` | Create default heartbeat jobs for all agents |

### Webhooks

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/webhooks` | List webhooks |
| `POST` | `/api/webhooks` | Create webhook (optional HMAC secret) |
| `GET` | `/api/webhooks/:id` | Get webhook |
| `PUT` | `/api/webhooks/:id` | Update webhook |
| `DELETE` | `/api/webhooks/:id` | Delete webhook |
| `POST` | `/api/webhooks/:id/test` | Dry-run: render template |
| `POST` | `/api/webhooks/trigger/:webhookId` | Inbound trigger (validates HMAC, runs agent) |

### Devices

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/devices` | List paired devices |
| `DELETE` | `/api/devices/:deviceId` | Revoke device |

### Terminal

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/terminal/sessions` | List terminal sessions |
| `GET` | `/api/terminal/sessions/:id` | Get session transcript |
| `POST` | `/api/terminal/exec` | Execute shell command |
| `GET` | `/api/terminal/quick-commands` | Quick command templates |

### Filesystem

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/filesystem/list` | List directory contents |
| `GET` | `/api/filesystem/info` | File/directory metadata |
| `GET` | `/api/filesystem/read` | Read file (text/binary, offset/limit) |
| `PUT` | `/api/filesystem/write` | Write file |
| `POST` | `/api/filesystem/folder` | Create directory |
| `POST` | `/api/filesystem/upload` | Upload file |
| `PUT` | `/api/filesystem/rename` | Rename file/directory |
| `DELETE` | `/api/filesystem/delete` | Delete file/directory |
| `GET` | `/api/filesystem/download` | Download file |

### Other

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/hooks/active` | Active hooks |
| `GET` | `/api/hooks/history` | Hook execution history |
| `POST` | `/api/hooks/ingest` | Receive SDK hook events (public) |
| `GET` | `/api/skills` | List all skills across agents |
| `GET/PUT/DELETE` | `/api/api-keys/:provider` | Manage API keys |
| `POST` | `/api/transcribe` | Audio transcription (requires OpenAI key) |
| `GET` | `/api/sessions` | List SDK sessions |
| `DELETE` | `/api/sessions/:key` | Delete SDK session |

---

## Data Storage

All data is stored in-memory with immediate file-based persistence. No external database.

```
~/.pawd-bridge/
├── .env                        # API keys (CLAUDE_CODE_OAUTH_TOKEN, etc.)
├── data/
│   ├── auth/
│   │   ├── bridge-secret.json  # 64-byte HMAC key
│   │   ├── pairing-secret.json # 32-char hex pairing secret
│   │   └── devices.json        # Paired device registry
│   ├── agents/                 # JSON file per agent
│   ├── conversations/          # Directory per conversation
│   │   └── {convId}/
│   │       ├── meta.md         # YAML frontmatter metadata
│   │       ├── messages.jsonl  # Chat messages (one per line)
│   │       └── sessions/       # SDK session transcripts
│   ├── tasks/                  # JSON file per task
│   ├── webhooks/               # JSON file per webhook
│   ├── terminal/               # Terminal session transcripts
│   ├── activity/               # Activity feed events
│   ├── uploads/                # Uploaded files (served at /api/uploads/)
│   ├── sessions/               # SDK session state
│   ├── cron-jobs.json          # Cron job definitions
│   ├── cron-runs.json          # Cron run history
│   └── tokens.json             # Token usage accounting
├── workspaces/                 # Per-agent SDK workspaces
│   └── {agentId}/
│       ├── .claude/            # Claude Code settings + skills
│       ├── IDENTITY.md
│       ├── SOUL.md
│       ├── HEARTBEAT.md
│       └── ...
├── bridge.pid                  # PID file (CLI daemon mode)
└── bridge.log                  # Log file (CLI daemon mode)
```

---

## Nginx Reverse Proxy

```bash
sudo bash apps/bridge/scripts/install-nginx-bridge.sh
sudo bash apps/bridge/scripts/install-nginx-bridge.sh --domain bridge.example.com
sudo bash apps/bridge/scripts/install-nginx-bridge.sh --port 8080 --bridge-port 3001
```

The script installs Nginx, creates a reverse proxy config optimized for SSE (buffering disabled), and optionally configures SSL via Let's Encrypt.

---

## Development

```bash
cd apps/bridge
npm run dev              # Hot reload with tsx watch
npm run test:endpoints   # API tests (requires running bridge)
npm run build && npm start  # Production
```

### Project Structure

```
apps/bridge/src/
├── index.ts              # Startup: init stores, start cron, listen
├── config.ts             # Env vars and path resolution
├── api/
│   ├── server.ts         # Fastify setup, plugins, route registration
│   ├── middleware/        # Auth (device token) & error handling
│   └── routes/           # 28 route modules (~50 endpoints)
├── sdk/
│   ├── agent-runner.ts   # Core: runAgent() fire-and-forget execution
│   ├── agent-config.ts   # Load agent config + personality files
│   ├── message-stream.ts # Push-based async iterable for multi-turn
│   ├── session-store.ts  # Session persistence
│   ├── workspace.ts      # Agent workspace file management
│   └── types.ts          # SDK type definitions
├── store/
│   ├── entities/         # In-memory + file stores (agents, conversations, tasks, webhooks, etc.)
│   └── markdown/         # Markdown serializer/parser for conversation metadata
├── auth/                 # Device manager: HMAC tokens, pairing, revocation
├── events/               # SSE event bus with ring buffer replay
├── cron/                 # Scheduler (30s tick) + job/run persistence
├── hooks/                # Hook ingestion and tracking
├── tasks/                # Periodic task state sync (60s interval)
├── templates/            # Personality file generators
└── utils/                # Prefixed ID generation, Pino logger
```

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| HTTP Server | [Fastify](https://fastify.dev) v5 |
| AI SDK | [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk) |
| Language | TypeScript (ES2022, ESM) |
| Logging | [Pino](https://getpino.io) |
| Auth | HMAC-SHA256 (Node.js `crypto`) |
| CLI | [Commander.js](https://github.com/tj/commander.js) + [Chalk](https://github.com/chalk/chalk) |
| Reverse Proxy | Nginx |

---

## License

MIT

---

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes (`git commit -am 'Add my feature'`)
4. Push to the branch (`git push origin feature/my-feature`)
5. Open a Pull Request
