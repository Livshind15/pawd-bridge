# Pawd Bridge

**Bridge server between [OpenClaw](https://openclaw.ai) Gateway and the Pawd mobile app.**

Pawd Bridge is a self-hosted Fastify server that connects your OpenClaw AI agent network to the Pawd iOS/Android app via HTTP + SSE. It manages conversations, agents, tasks, cron jobs, device pairing, and real-time event streaming — all from a single lightweight process.

---

## Features

- **Real-time agent communication** — WebSocket bridge to OpenClaw Gateway with automatic reconnection
- **Device pairing** — Ed25519 cryptographic device authentication with QR code pairing
- **Conversation persistence** — Store and retrieve chat history with tool calls, reasoning, and metadata
- **Agent management** — CRUD agents with bidirectional sync to OpenClaw
- **Session control** — List, compact, reset, and delete gateway sessions
- **Cron jobs** — Schedule and manage agent heartbeats and recurring tasks
- **Terminal** — Execute shell commands from the mobile app
- **File management** — Browse, read, and write files on the server
- **Workspace sync** — Manage agent identity, soul, memory, and skills via markdown files
- **API key management** — Auto-bootstrap keys from OpenClaw auth profiles
- **SSE event stream** — Real-time updates pushed to connected clients
- **Nginx integration** — One-command reverse proxy setup with SSL support
- **CLI tool** — `pawd` command to install, start, stop, and monitor the bridge

---

## Architecture

```
+------------------+       WebSocket        +-------------------+
|   Pawd Mobile    | <---  HTTP/SSE  --->   |   Pawd Bridge     |
|   (iOS/Android)  |                        |   (Fastify:3001)  |
+------------------+                        +--------+----------+
                                                     |
                                              WebSocket (v3)
                                                     |
                                            +--------v----------+
                                            |  OpenClaw Gateway  |
                                            |   (port 18789)     |
                                            +--------+----------+
                                                     |
                                            +--------v----------+
                                            |   AI Agents        |
                                            |   (LLM backends)   |
                                            +--------------------+
```

---

## Quick Start

### Prerequisites

- **Node.js** >= 18
- **OpenClaw** installed and running ([docs.openclaw.ai](https://docs.openclaw.ai))

### Install & Run

```bash
# Clone the repository
git clone https://github.com/AiPawd/pawd-bridge.git
cd pawd-bridge

# Install dependencies
npm install

# Build
cd apps/bridge
npm run build

# Start
npm start
```

The bridge will start on `http://localhost:3001` and connect to OpenClaw at `ws://localhost:18789`.

### Using the CLI

```bash
# Install the CLI globally
cd apps/cli
npm install && npm run build
npm link

# Full setup (deps + build + Nginx)
pawd install

# Start the bridge as a background service
pawd start

# Check everything is running
pawd status

# Show QR code for mobile pairing
pawd pair
```

---

## Configuration

All configuration is via environment variables. Create a `.env` file in `apps/bridge/` or export them directly.

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | HTTP server port |
| `DATA_DIR` | `~/.pawd-bridge/data` | Persistent data directory |
| `GATEWAY_URL` | `ws://localhost:18789` | OpenClaw gateway WebSocket URL |
| `GATEWAY_TOKEN` | _(auto from OpenClaw)_ | Gateway authentication token |
| `GATEWAY_PASSWORD` | _(empty)_ | Gateway password (if required) |
| `OPENCLAW_WORKSPACE` | `~/.openclaw/workspace` | OpenClaw workspace directory |
| `LOG_LEVEL` | `info` | Log level (`debug`, `info`, `warn`, `error`) |

### API Keys (auto-bootstrapped)

The bridge automatically loads API keys from OpenClaw's agent auth profiles at `~/.openclaw/agents/*/agent/auth-profiles.json`. You can also set them manually:

| Variable | Provider |
|----------|----------|
| `OPENROUTER_API_KEY` | OpenRouter |
| `ANTHROPIC_API_KEY` | Anthropic |
| `OPENAI_API_KEY` | OpenAI |
| `GOOGLE_API_KEY` | Google AI |
| `GROQ_API_KEY` | Groq |
| `MISTRAL_API_KEY` | Mistral |
| `TOGETHER_API_KEY` | Together AI |
| `DEEPSEEK_API_KEY` | DeepSeek |

---

## CLI Reference

The `pawd` CLI manages the bridge lifecycle.

### `pawd install`

Full first-time setup: install dependencies, build the bridge, configure Nginx.

```bash
pawd install                    # Full install
pawd install --skip-nginx       # Skip Nginx setup
pawd install --skip-build       # Skip build step
pawd install --domain my.domain # Set Nginx server_name for SSL
```

### `pawd start`

Start the bridge as a background service.

```bash
pawd start                      # Start as daemon
pawd start --port 8080          # Custom port
pawd start --foreground         # Run in foreground (Ctrl+C to stop)
```

### `pawd stop`

Stop the running bridge.

```bash
pawd stop                       # Graceful shutdown (SIGTERM)
pawd stop --force               # Force kill (SIGKILL)
```

### `pawd status`

Display service health dashboard.

```
$ pawd status

  Service              Status
  Bridge               ● Running (PID 12345)
  Bridge port 3001     ● Listening
  OpenClaw gateway     ● Connected (ws://localhost:18789)
  Nginx (port 80)      ● Running
  Device identity      ● Configured (a1b2c3...)
```

### `pawd logs`

Tail bridge logs.

```bash
pawd logs                       # Follow mode (last 50 lines)
pawd logs --lines 100           # Show last 100 lines
pawd logs --no-follow           # Print and exit
```

### `pawd pair`

Show device pairing information with QR code.

```bash
pawd pair                       # Display QR code + device info
pawd pair --json                # Output as JSON
pawd pair --no-qr               # Text only
```

---

## API Reference

### Public Endpoints (No Auth)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `GET` | `/api/status` | Server status, uptime, agent stats |
| `GET` | `/api/events` | SSE event stream |
| `POST` | `/api/devices/pair` | Device pairing |
| `GET` | `/api/devices/pair-info` | Pairing info (URL + secret) |

### Agents

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/agents` | List all agents |
| `GET` | `/api/agents/:id` | Get agent details |
| `POST` | `/api/agents` | Create agent |
| `PUT` | `/api/agents/:id` | Update agent |
| `DELETE` | `/api/agents/:id` | Delete agent |
| `GET` | `/api/agents/:id/skills` | List agent skills |
| `GET` | `/api/agents/:id/tools` | List agent tools |

### Chat & Conversations

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/conversations` | List conversations |
| `GET` | `/api/conversations/:id` | Get conversation with messages |
| `PATCH` | `/api/conversations/:id` | Rename conversation |
| `POST` | `/api/conversations/:id/abort` | Abort ongoing generation |
| `DELETE` | `/api/conversations/:id` | Delete conversation |

### Sessions

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/sessions` | List gateway sessions |
| `GET` | `/api/sessions/:key/preview` | Session preview |
| `GET` | `/api/sessions/:key/status` | Session status |
| `POST` | `/api/sessions/:key/compact` | Compact session history |
| `POST` | `/api/sessions/:key/model` | Change session model |
| `POST` | `/api/sessions/:key/reset` | Reset session |
| `DELETE` | `/api/sessions/:key` | Delete session |

### Tasks

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/tasks/:id` | Get task |
| `GET` | `/api/tasks/:id/output` | Get task output |
| `POST` | `/api/tasks` | Create task |
| `PUT` | `/api/tasks/:id` | Update task |
| `DELETE` | `/api/tasks/:id` | Delete task |

### Cron Jobs

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/cron/:agentId/heartbeat` | Agent heartbeat |
| `PUT` | `/api/cron/jobs/:id` | Update cron job |
| `DELETE` | `/api/cron/jobs/:id` | Delete cron job |
| `POST` | `/api/cron/jobs/:id/run` | Run job immediately |
| `GET` | `/api/cron/runs` | List job run history |

### Devices

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/devices/token/rotate` | Rotate device token |
| `POST` | `/api/devices/token/revoke` | Revoke device token |
| `DELETE` | `/api/devices/:deviceId` | Remove paired device |

### Files & Workspace

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/workspace/files` | List workspace files |
| `GET` | `/api/workspace/files/:name` | Read workspace file |
| `PUT` | `/api/workspace/files/:name` | Write workspace file |
| `GET` | `/api/filesystem` | Browse server filesystem |
| `GET` | `/api/filesystem/read` | Read file |
| `PUT` | `/api/filesystem/write` | Write file |

### Additional Endpoints

| Area | Path Prefix | Description |
|------|-------------|-------------|
| Skills | `/api/skills/*` | Agent skill management |
| Skill Registry | `/api/skill-registry/*` | Skill marketplace & registration |
| Integrations | `/api/integrations/*` | Connected services |
| API Keys | `/api/api-keys/*` | Provider API key management |
| Terminal | `/api/terminal/*` | Shell command execution |
| Metrics | `/api/metrics/*` | CPU, memory, storage metrics |
| Hooks | `/api/hooks/*` | Event hook management |
| Uploads | `/api/uploads/*` | File upload handling |
| Transcription | `/api/transcribe` | Audio transcription |
| Nodes | `/api/nodes/*` | Node pairing & invocation |

---

## Device Authentication

Pawd Bridge uses **Ed25519** cryptographic signatures for device pairing.

1. On first startup, the bridge generates an Ed25519 keypair stored at `~/.pawd-bridge/data/identity/device.json`
2. The **Device ID** is derived as `SHA-256(raw_public_key)`
3. When connecting to the gateway, the bridge signs a challenge nonce with its private key
4. Mobile devices pair by scanning a QR code containing `{ bridgeUrl, secret }`
5. Paired devices receive a time-limited token for subsequent API requests

To approve a device in OpenClaw:

```bash
openclaw devices approve <deviceId>
```

---

## Nginx Reverse Proxy

Expose the bridge on port 80 (or 443 with SSL):

```bash
# Automatic setup
sudo bash apps/bridge/scripts/install-nginx-bridge.sh

# With custom domain (for SSL)
sudo bash apps/bridge/scripts/install-nginx-bridge.sh --domain bridge.example.com

# Custom ports
sudo bash apps/bridge/scripts/install-nginx-bridge.sh --port 8080 --bridge-port 3001
```

The script:
- Installs Nginx (Ubuntu/Debian, Fedora/RHEL, macOS via Homebrew)
- Creates a reverse proxy config optimized for SSE
- Disables response buffering for real-time streaming
- Optionally configures SSL via Let's Encrypt (`certbot --nginx -d <domain>`)

---

## Data Storage

All persistent data is stored under `~/.pawd-bridge/data/`:

```
~/.pawd-bridge/
├── data/
│   ├── identity/
│   │   └── device.json          # Ed25519 device keypair
│   ├── auth/
│   │   ├── pairing-secret.json  # Pairing secret
│   │   └── devices.json         # Paired device registry
│   ├── uploads/                 # Uploaded files
│   ├── conversations.json       # Chat history
│   ├── agents.json              # Agent metadata
│   └── tasks/                   # Task files
├── bridge.pid                   # PID file (when using CLI)
└── bridge.log                   # Log file (when using CLI)
```

---

## Development

```bash
# Start in development mode with hot reload
cd apps/bridge
npm run dev

# Run API endpoint tests (requires running bridge)
npm run test:endpoints

# Build for production
npm run build
npm start
```

### Project Structure

```
apps/bridge/
├── src/
│   ├── index.ts                 # Entry point & startup
│   ├── config.ts                # Environment configuration
│   ├── seed.ts                  # Initial data seeding
│   ├── api/
│   │   ├── server.ts            # Fastify setup & route registration
│   │   ├── middleware/          # Auth & error handling
│   │   └── routes/              # API endpoint handlers
│   ├── gateway/
│   │   ├── client.ts            # WebSocket client
│   │   ├── protocol.ts          # Message types & methods
│   │   ├── auth.ts              # Device identity & signing
│   │   ├── sync.ts              # Agent synchronization
│   │   ├── events.ts            # Event routing
│   │   └── response-parser.ts   # Gateway response parsing
│   ├── store/
│   │   ├── entities/            # Data models (agents, conversations, tasks)
│   │   ├── markdown/            # Markdown serialization
│   │   └── workspace.ts         # OpenClaw workspace integration
│   ├── auth/                    # Device token management
│   ├── events/                  # SSE event bus
│   ├── hooks/                   # Hook management
│   ├── tasks/                   # Task state sync
│   ├── templates/               # Heartbeat & skill templates
│   └── utils/                   # Logger, ID generation
├── scripts/
│   ├── install-nginx-bridge.sh  # Nginx setup script
│   └── test-endpoints.ts        # API testing script
├── package.json
└── tsconfig.json
```

---

## Gateway Protocol

The bridge communicates with OpenClaw via a WebSocket JSON protocol (v3):

| Message Type | Format | Description |
|-------------|--------|-------------|
| Request | `{ type: "req", id, method, params }` | Client → Gateway |
| Response | `{ type: "res", id, ok, payload/error }` | Gateway → Client |
| Event | `{ event, payload, seq }` | Gateway → Client (push) |

**Capabilities:** `exec.approval`, `cron`, `chat.stream`, `agent.stream`, `tool.stream`, `web`, `canvas`, `node.commands`, `skills.hub`, `sessions.manage`, `hooks.events`, `device.manage`

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| HTTP Server | [Fastify](https://fastify.dev) v5 |
| WebSocket | [ws](https://github.com/websockets/ws) v8 |
| Language | TypeScript (ES2022, ESM) |
| Logging | [Pino](https://getpino.io) |
| Cryptography | Node.js `crypto` (Ed25519) |
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
