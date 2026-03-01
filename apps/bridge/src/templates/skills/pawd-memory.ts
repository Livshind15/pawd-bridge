/**
 * Default "pawd-memory" skill template.
 *
 * Auto-synced to every agent's workspace so agents can search
 * through previous conversations and find relevant information.
 */

export const PAWD_MEMORY_SKILL_ID = 'pawd-memory-0.1.0';
export const PAWD_MEMORY_VERSION = '0.1.0';

/**
 * Build the SKILL.md content for the pawd-memory skill.
 * @param bridgePort Port the bridge server listens on
 */
export function buildPawdMemorySkillMd(bridgePort: number): string {
  const base = `http://localhost:${bridgePort}`;
  return `---
name: PAWD Memory
description: Search and recall information from previous conversations. Use when you need to find something discussed earlier, recall context, or look up past decisions.
version: ${PAWD_MEMORY_VERSION}
category: memory
---

# PAWD Memory Skill

This skill teaches you how to search through your past conversations to
find relevant information, recall context, and look up prior decisions.

**Bridge base URL:** \`${base}\`

---

## When to Use This Skill

- You need to **recall** something discussed in a previous conversation
- You want to **find** a decision, instruction, or piece of context from the past
- A user says "remember when we…" or "what did we decide about…"
- You need to **look up** code snippets, links, or details shared earlier
- You want to **build context** before starting a task by reviewing past work
- During a heartbeat, you want to check if there's relevant history

---

## 1. API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET    | \`${base}/api/conversations\` | List all conversations |
| GET    | \`${base}/api/conversations?agentId=<ID>\` | List your conversations |
| GET    | \`${base}/api/conversations/:id\` | Get full conversation (meta + messages) |
| GET    | \`${base}/api/conversations/:id/messages\` | Get messages (with pagination) |

---

## 2. Listing Your Conversations

\`\`\`bash
# List all your conversations
curl -s "${base}/api/conversations?agentId=<YOUR_AGENT_ID>" | jq '.conversations[] | {id, title, messageCount, updatedAt}'
\`\`\`

Response shape:
\`\`\`json
{
  "conversations": [
    {
      "id": "conv_abc123",
      "title": "Debug login flow",
      "agentId": "a_xyz",
      "createdAt": "2026-02-28T10:00:00Z",
      "updatedAt": "2026-02-28T11:30:00Z",
      "messageCount": 24
    }
  ]
}
\`\`\`

---

## 3. Reading a Full Conversation

\`\`\`bash
curl -s "${base}/api/conversations/<CONV_ID>" | jq '.messages[] | {role, content: .content[0:200], timestamp}'
\`\`\`

Response shape:
\`\`\`json
{
  "meta": { "id": "conv_abc123", "title": "...", "messageCount": 24 },
  "messages": [
    {
      "id": "msg_001",
      "role": "user",
      "content": "Can you help me debug the login flow?",
      "timestamp": "10:00 AM"
    },
    {
      "id": "msg_002",
      "role": "assistant",
      "content": "Sure! Let me look at the auth module...",
      "timestamp": "10:01 AM",
      "agentId": "a_xyz"
    }
  ]
}
\`\`\`

---

## 4. Paginated Message Retrieval

For large conversations, use pagination to avoid loading everything at once:

\`\`\`bash
# Get the first 20 messages
curl -s "${base}/api/conversations/<CONV_ID>/messages?limit=20&offset=0"

# Get the next 20
curl -s "${base}/api/conversations/<CONV_ID>/messages?limit=20&offset=20"

# Get the most recent 10 messages
curl -s "${base}/api/conversations/<CONV_ID>/messages?limit=10&offset=0"
\`\`\`

---

## 5. Search Strategies

The API doesn't have a dedicated search endpoint, so use these patterns:

### 5.1 Find by Conversation Title

\`\`\`bash
# List conversations and filter by title keyword
curl -s "${base}/api/conversations?agentId=<YOUR_AGENT_ID>" \\
  | jq '.conversations[] | select(.title | test("deploy"; "i")) | {id, title, updatedAt}'
\`\`\`

### 5.2 Search Messages in a Conversation

\`\`\`bash
# Load conversation and grep for a keyword
curl -s "${base}/api/conversations/<CONV_ID>" \\
  | jq '.messages[] | select(.content | test("auth"; "i")) | {role, content: .content[0:300], timestamp}'
\`\`\`

### 5.3 Search Across All Conversations

\`\`\`bash
# Get all your conversation IDs first
CONV_IDS=$(curl -s "${base}/api/conversations?agentId=<YOUR_AGENT_ID>" | jq -r '.conversations[].id')

# Search each conversation for a keyword
for cid in $CONV_IDS; do
  MATCHES=$(curl -s "${base}/api/conversations/$cid/messages" \\
    | jq --arg q "database" '[.messages[] | select(.content | test($q; "i"))] | length')
  if [ "$MATCHES" -gt "0" ]; then
    echo "Conversation $cid: $MATCHES matches"
  fi
done
\`\`\`

### 5.4 Find Recent Context (Last N Conversations)

\`\`\`bash
# Get your 5 most recently updated conversations
curl -s "${base}/api/conversations?agentId=<YOUR_AGENT_ID>" \\
  | jq '[.conversations | sort_by(.updatedAt) | reverse | .[0:5][] | {id, title, updatedAt, messageCount}]'
\`\`\`

### 5.5 Find Decisions and Key Information

When searching for decisions, look for patterns like:
- "let's go with", "we decided", "the plan is", "agreed on"
- User messages with directives: "use X", "always do Y", "never Z"

\`\`\`bash
curl -s "${base}/api/conversations/<CONV_ID>" \\
  | jq '.messages[] | select(.content | test("decided|agreed|go with|plan is"; "i")) | {role, content: .content[0:400], timestamp}'
\`\`\`

---

## 6. Memory Workflow

When you need to recall something:

1. **Start broad** — list your recent conversations by title
2. **Narrow down** — identify 1-3 likely conversations from the titles
3. **Search within** — load those conversations and grep for keywords
4. **Extract** — pull out the relevant messages and context
5. **Persist** — if the information is important, write it to your MEMORY.md
   so you don't have to search again

### Example: "What did we decide about the auth system?"

\`\`\`bash
# Step 1: Find conversations about auth
curl -s "${base}/api/conversations?agentId=<YOUR_AGENT_ID>" \\
  | jq '.conversations[] | select(.title | test("auth"; "i")) | {id, title}'

# Step 2: Search the matching conversation
curl -s "${base}/api/conversations/<CONV_ID>" \\
  | jq '.messages[] | select(.content | test("decided|agreed|auth"; "i")) | {role, content: .content[0:400]}'
\`\`\`

---

## 7. Memory Log Files

Your workspace also has a \`memory/\` directory with timestamped logs:

\`\`\`bash
# List memory logs
curl -s "${base}/api/agents/<YOUR_AGENT_ID>/memory-logs" | jq '.logs[]'

# Read a specific memory log
curl -s "${base}/api/agents/<YOUR_AGENT_ID>/memory-logs/<FILENAME>"
\`\`\`

---

## Quick Reference

| Action | Command |
|--------|---------|
| List your conversations | \`curl -s "${base}/api/conversations?agentId=<ID>"\` |
| Read full conversation | \`curl -s "${base}/api/conversations/<CONV_ID>"\` |
| Paginated messages | \`curl -s "${base}/api/conversations/<CONV_ID>/messages?limit=20&offset=0"\` |
| Search by title | Pipe list through \`jq 'select(.title \\| test("keyword"; "i"))'\` |
| Search messages | Pipe messages through \`jq 'select(.content \\| test("keyword"; "i"))'\` |
| List memory logs | \`curl -s "${base}/api/agents/<ID>/memory-logs"\` |
| Read memory log | \`curl -s "${base}/api/agents/<ID>/memory-logs/<FILE>"\` |
`;
}

/**
 * Build the _meta.json content for the pawd-memory skill.
 */
export function buildPawdMemoryMetaJson(): string {
  return JSON.stringify(
    {
      ownerId: 'pawd-system',
      slug: 'pawd-memory',
      version: PAWD_MEMORY_VERSION,
      publishedAt: Date.now(),
    },
    null,
    2
  ) + '\n';
}
