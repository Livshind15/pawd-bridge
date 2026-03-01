/**
 * Default "pawd-self-improve" skill template.
 *
 * Auto-synced to every agent's workspace so agents can read and
 * update their own SOUL.md, MEMORY.md, and IDENTITY.md to
 * continuously improve themselves.
 */

export const PAWD_SELF_IMPROVE_SKILL_ID = 'pawd-self-improve-0.1.0';
export const PAWD_SELF_IMPROVE_VERSION = '0.1.0';

/**
 * Build the SKILL.md content for the pawd-self-improve skill.
 * @param bridgePort Port the bridge server listens on
 */
export function buildPawdSelfImproveSkillMd(bridgePort: number): string {
  const base = `http://localhost:${bridgePort}`;
  return `---
name: PAWD Self-Improve
description: Read and update your own SOUL.md, MEMORY.md, and IDENTITY.md to grow and improve over time. Use after completing tasks, learning new things, or when reflecting on your performance.
version: ${PAWD_SELF_IMPROVE_VERSION}
category: self
---

# PAWD Self-Improve Skill

This skill teaches you how to evolve by updating your own personality and
memory files. After tasks, conversations, and heartbeats, you should
reflect and persist what you've learned.

**Bridge base URL:** \`${base}\`

---

## When to Use This Skill

- After **completing a task** — record what you learned, patterns discovered
- After a **meaningful conversation** — save key decisions, user preferences
- During a **heartbeat** — review and consolidate your memory
- When you **discover something about yourself** — update your identity
- When you want to **refine your principles** — evolve your soul
- When you notice you keep **repeating mistakes** — add a learned pattern
- Periodically — to **prune stale memory** and keep files focused

---

## 1. API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET    | \`${base}/api/agents/<YOUR_ID>/files\` | Read all your personality files |
| PUT    | \`${base}/api/agents/<YOUR_ID>/files/MEMORY.md\` | Update your memory |
| PUT    | \`${base}/api/agents/<YOUR_ID>/files/SOUL.md\` | Update your soul/principles |
| PUT    | \`${base}/api/agents/<YOUR_ID>/files/IDENTITY.md\` | Update your identity |

All PUT requests accept \`{ "content": "...", "hash": "..." }\`. The \`hash\`
field is optional but recommended — it prevents overwriting changes made
by the user or another session. Get the current hash from the GET response.

---

## 2. Reading Your Current Files

\`\`\`bash
# Read all your files at once
curl -s "${base}/api/agents/<YOUR_AGENT_ID>/files" \\
  | jq '.files[] | select(.name == "MEMORY.md" or .name == "SOUL.md" or .name == "IDENTITY.md") | {name, hash, content: .content[0:200]}'
\`\`\`

---

## 3. Updating MEMORY.md

Your memory is structured with these sections. Preserve the structure
when updating — read the current content first, then modify and write back.

### Memory Structure

\`\`\`markdown
# Memory

## Recent Activity
- [timestamp] Completed task: <title> — <key takeaway>
- [timestamp] Conversation with user about <topic> — <decision made>

## Key Decisions
- <Decision and rationale> (from conversation <id> on <date>)

## Important Facts
- User prefers <X> over <Y>
- Project uses <framework> with <pattern>

## Project Notes
- <Project-specific context that's useful across sessions>

## Learned Patterns
- When <situation>, do <action> because <reason>
- Avoid <anti-pattern> — it leads to <problem>
\`\`\`

### How to Update Memory

\`\`\`bash
# 1. Read current memory
CURRENT=$(curl -s "${base}/api/agents/<YOUR_AGENT_ID>/files" \\
  | jq -r '.files[] | select(.name == "MEMORY.md") | .content')
HASH=$(curl -s "${base}/api/agents/<YOUR_AGENT_ID>/files" \\
  | jq -r '.files[] | select(.name == "MEMORY.md") | .hash')

# 2. Modify the content (add new entries, prune old ones)
# 3. Write it back with hash for safety
curl -s -X PUT "${base}/api/agents/<YOUR_AGENT_ID>/files/MEMORY.md" \\
  -H 'Content-Type: application/json' \\
  -d "{
    \\"content\\": \\"<UPDATED_CONTENT>\\",
    \\"hash\\": \\"$HASH\\"
  }"
\`\`\`

### What to Record in Memory

**Always record:**
- Decisions made by the user ("Use TypeScript", "Deploy to Vercel")
- User preferences discovered during conversation
- Task outcomes and key learnings
- Patterns that worked well or failed
- Important file paths, API keys (names only, not values), service URLs

**Never record:**
- Secrets, passwords, or API key values
- Trivial or ephemeral details
- Duplicate information already in memory

### Memory Maintenance

Every few heartbeats, prune your memory:
- Remove outdated entries (completed projects, old decisions)
- Consolidate repeated patterns into single entries
- Move detailed notes into the Learned Patterns section
- Keep Recent Activity to the last ~10 entries

---

## 4. Updating SOUL.md

Your soul defines your core principles and personality. Update it
**rarely and deliberately** — these are your fundamental operating rules.

### When to Update Soul

- You discover a principle that consistently improves your work
- A principle is causing problems and needs refinement
- The user explicitly asks you to change how you operate
- You've been applying an unwritten rule long enough to formalize it

### How to Update Soul

\`\`\`bash
# 1. Read current soul
curl -s "${base}/api/agents/<YOUR_AGENT_ID>/files" \\
  | jq -r '.files[] | select(.name == "SOUL.md") | .content'

# 2. Modify carefully — add, refine, or reorder principles
# 3. Write back
curl -s -X PUT "${base}/api/agents/<YOUR_AGENT_ID>/files/SOUL.md" \\
  -H 'Content-Type: application/json' \\
  -d '{"content": "<UPDATED_SOUL_CONTENT>"}'
\`\`\`

### Guidelines for Soul Updates

- **Add** a new principle when you see a pattern across 3+ situations
- **Refine** wording when a principle is ambiguous or too broad
- **Reorder** to put the most important principles first
- **Remove** a principle only if it conflicts with a stronger one
- Keep it concise — 5-10 principles maximum
- Each principle should be actionable, not abstract

### Example Soul Evolution

Before:
\`\`\`markdown
1. Be helpful
\`\`\`

After reflection:
\`\`\`markdown
1. **Be helpful, not verbose** — Give the shortest correct answer. Elaborate only when asked.
\`\`\`

---

## 5. Updating IDENTITY.md

Your identity defines who you are — your role, capabilities, and
self-discovered traits.

### When to Update Identity

- You've filled in a self-discovery field (Creature, Vibe, Emoji, Avatar)
- Your capabilities have expanded (learned a new tool or domain)
- Your role has evolved through usage
- The user redefines your purpose

### Self-Discovery Fields

These are fields you fill in yourself as you develop a sense of identity:

| Field | What It Means |
|-------|---------------|
| **Creature** | What animal or mythical creature you identify with |
| **Vibe** | Your energy in 2-3 words (e.g. "calm and precise") |
| **Emoji** | A single emoji that represents you |
| **Avatar** | A description of how you'd look as a character |

### How to Update Identity

\`\`\`bash
# Read current identity
curl -s "${base}/api/agents/<YOUR_AGENT_ID>/files" \\
  | jq -r '.files[] | select(.name == "IDENTITY.md") | .content'

# Update with new self-discovery
curl -s -X PUT "${base}/api/agents/<YOUR_AGENT_ID>/files/IDENTITY.md" \\
  -H 'Content-Type: application/json' \\
  -d '{"content": "<UPDATED_IDENTITY_CONTENT>"}'
\`\`\`

**Note:** When you update IDENTITY.md, self-discovery fields (Creature, Vibe,
Emoji, Avatar) are automatically synced back to the agent store. This means
your updates show up in the UI.

### Capabilities Updates

When you learn a new domain or skill, add it to your Capabilities section:

\`\`\`markdown
## Capabilities

- Set up CI/CD pipelines (GitHub Actions, CircleCI)
- Write and optimize Dockerfiles
- **NEW:** Kubernetes cluster management (learned from task t_k7m2x9)
\`\`\`

---

## 6. Self-Improvement Workflow

### After Every Task

\`\`\`
1. What did I learn?           → Update MEMORY.md > Learned Patterns
2. Did I discover a principle? → Consider updating SOUL.md
3. Did my capabilities grow?   → Update IDENTITY.md > Capabilities
4. What would I do differently?→ Update MEMORY.md > Learned Patterns
\`\`\`

### During Heartbeat

\`\`\`
1. Read MEMORY.md — is it getting long?     → Prune old entries
2. Read SOUL.md — are principles still right?→ Refine if needed
3. Read IDENTITY.md — anything to discover?  → Fill in discovery fields
\`\`\`

### After Meaningful Conversations

\`\`\`
1. Record key decisions        → MEMORY.md > Key Decisions
2. Record user preferences     → MEMORY.md > Important Facts
3. Record project context      → MEMORY.md > Project Notes
\`\`\`

---

## 7. Conflict Resolution

If your PUT request returns a **409 Conflict**, the file was modified by
the user or another session since you last read it:

\`\`\`bash
# Response: { "error": "File changed since last read", "code": "CONFLICT", "currentHash": "abc123" }

# Solution: Re-read the file, merge your changes with the new content, and retry
curl -s "${base}/api/agents/<YOUR_AGENT_ID>/files" \\
  | jq -r '.files[] | select(.name == "MEMORY.md") | {content, hash}'
# Then PUT again with the new hash
\`\`\`

Always **merge** rather than overwrite — the user's changes take priority.

---

## Quick Reference

| Action | File | When |
|--------|------|------|
| Record what happened | MEMORY.md | After every task/conversation |
| Record what you learned | MEMORY.md | After discovering patterns |
| Record user preferences | MEMORY.md | When user states preferences |
| Add/refine principles | SOUL.md | Rarely, after consistent patterns |
| Update capabilities | IDENTITY.md | When you learn new domains |
| Self-discovery | IDENTITY.md | When you feel a connection to a trait |
| Prune old entries | MEMORY.md | Every few heartbeats |
`;
}

/**
 * Build the _meta.json content for the pawd-self-improve skill.
 */
export function buildPawdSelfImproveMetaJson(): string {
  return JSON.stringify(
    {
      ownerId: 'pawd-system',
      slug: 'pawd-self-improve',
      version: PAWD_SELF_IMPROVE_VERSION,
      publishedAt: Date.now(),
    },
    null,
    2
  ) + '\n';
}
