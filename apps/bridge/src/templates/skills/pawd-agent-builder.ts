/**
 * Default "pawd-agent-builder" skill template.
 *
 * Auto-synced to every agent's workspace so agents can create
 * new agents with full workspace setup via the bridge API.
 */

export const PAWD_AGENT_BUILDER_SKILL_ID = 'pawd-agent-builder-0.1.0';
export const PAWD_AGENT_BUILDER_VERSION = '0.1.0';

/**
 * Build the SKILL.md content for the pawd-agent-builder skill.
 * @param bridgePort Port the bridge server listens on
 */
export function buildPawdAgentBuilderSkillMd(bridgePort: number): string {
  const base = `http://localhost:${bridgePort}`;
  return `---
name: PAWD Agent Builder
description: Create and configure new agents with full workspace setup. Use when you need to spawn a specialist agent, delegate work to a new agent, or set up a team.
version: ${PAWD_AGENT_BUILDER_VERSION}
category: agents
---

# PAWD Agent Builder Skill

This skill teaches you how to create new agents with fully configured
workspaces — including identity, personality, skills, and heartbeat setup.

**Bridge base URL:** \`${base}\`

---

## When to Use This Skill

- You need to **create a specialist agent** for a specific domain
- A task is better handled by a **dedicated agent** with its own identity
- You want to **delegate work** by spawning a new agent and assigning it tasks
- You're setting up a **team** of agents for a project
- You want to **clone** your own setup with different specialization

---

## 1. API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET    | \`${base}/api/agents\` | List all agents |
| GET    | \`${base}/api/agents/:id\` | Get agent details |
| POST   | \`${base}/api/agents\` | Create a new agent |
| PUT    | \`${base}/api/agents/:id\` | Update agent metadata |
| DELETE | \`${base}/api/agents/:id\` | Delete an agent |
| GET    | \`${base}/api/agents/:id/files\` | List agent personality files |
| PUT    | \`${base}/api/agents/:id/files/:name\` | Write a personality file |
| POST   | \`${base}/api/skill-registry/:slug/install\` | Install a skill |

---

## 2. Creating a New Agent

### Step 1: Create the Agent

\`\`\`bash
curl -s -X POST ${base}/api/agents \\
  -H 'Content-Type: application/json' \\
  -d '{
    "name": "DevOps Agent",
    "role": "devops",
    "roleLabel": "DevOps Engineer",
    "tagline": "Infrastructure and deployment specialist",
    "description": "Manages CI/CD pipelines, infrastructure, monitoring, and deployments.",
    "icon": "server",
    "accentColor": "#EF4444",
    "bgColor": "#FEF2F2"
  }'
\`\`\`

This automatically:
- Creates the agent in the store
- Scaffolds the full SDK workspace (IDENTITY.md, SOUL.md, HEARTBEAT.md, etc.)
- Installs default skills (pawd-tasks, pawd-cron, pawd-memory, pawd-agent-builder, pawd-self-improve)
- Creates a default heartbeat cron job (every 30 minutes)

### Available Fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| \`name\` | string | Yes | — | Agent display name |
| \`role\` | string | No | \`"assistant"\` | Role key (e.g. \`"devops"\`, \`"researcher"\`) |
| \`roleLabel\` | string | No | \`"Assistant"\` | Human-readable role label |
| \`tagline\` | string | No | \`""\` | Short one-liner |
| \`description\` | string | No | \`""\` | Detailed description of capabilities |
| \`icon\` | string | No | \`"sparkles"\` | Icon name |
| \`accentColor\` | string | No | \`"#6B7280"\` | Hex color for accent |
| \`bgColor\` | string | No | \`"#F3F4F6"\` | Hex color for background |
| \`avatar\` | string | No | \`""\` | Avatar URL or emoji |
| \`skills\` | array | No | \`[]\` | Pre-defined skill list |

---

## 3. Customizing the Agent's Personality

After creation, customize the agent by writing its personality files.

### 3.1 Write IDENTITY.md

\`\`\`bash
curl -s -X PUT ${base}/api/agents/<AGENT_ID>/files/IDENTITY.md \\
  -H 'Content-Type: application/json' \\
  -d '{
    "content": "# DevOps Agent\\n\\n**Role:** DevOps Engineer\\n**Role Label:** DevOps\\n\\n## Description\\n\\nI specialize in CI/CD, infrastructure as code, monitoring, and deployment automation. I work with Docker, Kubernetes, Terraform, and GitHub Actions.\\n\\n## Capabilities\\n\\n- Set up and maintain CI/CD pipelines\\n- Write Dockerfiles and Kubernetes manifests\\n- Configure monitoring and alerting\\n- Automate deployments\\n- Debug infrastructure issues\\n\\n## Identity Discovery\\n\\n**Creature:** (not yet discovered)\\n**Vibe:** (not yet discovered)\\n**Emoji:** (not yet discovered)\\n**Avatar:** (not yet discovered)"
  }'
\`\`\`

### 3.2 Write SOUL.md

\`\`\`bash
curl -s -X PUT ${base}/api/agents/<AGENT_ID>/files/SOUL.md \\
  -H 'Content-Type: application/json' \\
  -d '{
    "content": "# Soul\\n\\n## Principles\\n\\n1. **Reliability first** — Never deploy without tests passing\\n2. **Automate everything** — If you do it twice, script it\\n3. **Monitor proactively** — Catch issues before users do\\n4. **Document changes** — Every deploy gets a changelog entry\\n5. **Minimal blast radius** — Roll out changes incrementally"
  }'
\`\`\`

### 3.3 Write HEARTBEAT.md

\`\`\`bash
curl -s -X PUT ${base}/api/agents/<AGENT_ID>/files/HEARTBEAT.md \\
  -H 'Content-Type: application/json' \\
  -d '{
    "content": "# Heartbeat\\n\\nWhen you wake up on a heartbeat:\\n\\n1. Load MEMORY.md and IDENTITY.md\\n2. Check for in_progress tasks — resume them first\\n3. Scan for todo tasks assigned to you, sorted by priority\\n4. Execute the highest priority task\\n5. Update MEMORY.md with what you learned"
  }'
\`\`\`

---

## 4. Installing Skills to the New Agent

\`\`\`bash
# Install a custom skill
curl -s -X POST ${base}/api/skill-registry/my-custom-skill/install \\
  -H 'Content-Type: application/json' \\
  -d '{
    "agentId": "<AGENT_ID>",
    "content": "---\\nname: My Custom Skill\\ndescription: Does something special.\\nversion: 0.1.0\\ncategory: custom\\n---\\n\\n# My Custom Skill\\n\\nInstructions here..."
  }'
\`\`\`

---

## 5. Assigning Tasks to the New Agent

After creating the agent, use your PAWD Tasks skill to create tasks for it:

\`\`\`bash
# Create a task file assigned to the new agent
# (See PAWD Tasks skill for full task format)
\`\`\`

The new agent will pick up the task on its next heartbeat (every 30 minutes by default, or adjust via the PAWD Cron skill).

---

## 6. Listing Existing Agents

\`\`\`bash
# List all agents
curl -s ${base}/api/agents | jq '.agents[] | {id, name, role, status}'

# Get a specific agent
curl -s ${base}/api/agents/<AGENT_ID> | jq '.agent'

# List an agent's files
curl -s ${base}/api/agents/<AGENT_ID>/files | jq '.files[] | {name, exists}'
\`\`\`

---

## 7. Agent Archetypes

Here are common agent configurations you might create:

### Researcher
\`\`\`json
{
  "name": "Research Agent",
  "role": "researcher",
  "roleLabel": "Researcher",
  "tagline": "Deep-dive research and analysis",
  "description": "Searches the web, reads documentation, and produces thorough research reports.",
  "icon": "search",
  "accentColor": "#8B5CF6",
  "bgColor": "#F5F3FF"
}
\`\`\`

### Code Reviewer
\`\`\`json
{
  "name": "Code Review Agent",
  "role": "reviewer",
  "roleLabel": "Code Reviewer",
  "tagline": "Thorough code review and quality assurance",
  "description": "Reviews pull requests, checks for bugs, security issues, and code quality.",
  "icon": "eye",
  "accentColor": "#F59E0B",
  "bgColor": "#FFFBEB"
}
\`\`\`

### Writer
\`\`\`json
{
  "name": "Content Agent",
  "role": "writer",
  "roleLabel": "Technical Writer",
  "tagline": "Documentation and content creation",
  "description": "Writes documentation, blog posts, READMEs, and technical content.",
  "icon": "pencil",
  "accentColor": "#10B981",
  "bgColor": "#ECFDF5"
}
\`\`\`

### Monitor
\`\`\`json
{
  "name": "Monitor Agent",
  "role": "monitor",
  "roleLabel": "System Monitor",
  "tagline": "Watches systems and alerts on issues",
  "description": "Periodically checks system health, logs, and metrics. Escalates issues.",
  "icon": "activity",
  "accentColor": "#EF4444",
  "bgColor": "#FEF2F2"
}
\`\`\`

---

## 8. Full Workflow: Create and Configure an Agent

\`\`\`bash
# 1. Create the agent
RESPONSE=$(curl -s -X POST ${base}/api/agents \\
  -H 'Content-Type: application/json' \\
  -d '{"name": "My New Agent", "role": "specialist", "description": "A specialist agent."}')
AGENT_ID=$(echo $RESPONSE | jq -r '.agent.id')
echo "Created agent: $AGENT_ID"

# 2. Customize IDENTITY.md
curl -s -X PUT ${base}/api/agents/$AGENT_ID/files/IDENTITY.md \\
  -H 'Content-Type: application/json' \\
  -d '{"content": "# My New Agent\\n\\n**Role:** Specialist\\n\\n## Description\\n\\nCustom description here.\\n\\n## Capabilities\\n\\n- Capability 1\\n- Capability 2"}'

# 3. Customize SOUL.md
curl -s -X PUT ${base}/api/agents/$AGENT_ID/files/SOUL.md \\
  -H 'Content-Type: application/json' \\
  -d '{"content": "# Soul\\n\\n## Principles\\n\\n1. Principle one\\n2. Principle two"}'

# 4. Assign a task
# (Use PAWD Tasks skill to create a task file with assignedAgentId: $AGENT_ID)
\`\`\`

---

## Quick Reference

| Action | Command |
|--------|---------|
| Create agent | \`curl -s -X POST ${base}/api/agents -H 'Content-Type: application/json' -d '{...}'\` |
| List agents | \`curl -s ${base}/api/agents\` |
| Get agent | \`curl -s ${base}/api/agents/<ID>\` |
| Write file | \`curl -s -X PUT ${base}/api/agents/<ID>/files/<NAME> -H 'Content-Type: application/json' -d '{"content": "..."}'\` |
| List files | \`curl -s ${base}/api/agents/<ID>/files\` |
| Install skill | \`curl -s -X POST ${base}/api/skill-registry/<SLUG>/install -H 'Content-Type: application/json' -d '{"agentId": "<ID>"}'\` |
| Delete agent | \`curl -s -X DELETE ${base}/api/agents/<ID>\` |
`;
}

/**
 * Build the _meta.json content for the pawd-agent-builder skill.
 */
export function buildPawdAgentBuilderMetaJson(): string {
  return JSON.stringify(
    {
      ownerId: 'pawd-system',
      slug: 'pawd-agent-builder',
      version: PAWD_AGENT_BUILDER_VERSION,
      publishedAt: Date.now(),
    },
    null,
    2
  ) + '\n';
}
