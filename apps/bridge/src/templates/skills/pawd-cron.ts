/**
 * Default "pawd-cron" skill template.
 *
 * Auto-synced to every agent's workspace so agents can create, list,
 * update, and delete cron jobs for themselves via the bridge API.
 */

export const PAWD_CRON_SKILL_ID = 'pawd-cron-0.1.0';
export const PAWD_CRON_VERSION = '0.1.0';

/**
 * Build the SKILL.md content for the pawd-cron skill.
 * @param bridgePort Port the bridge server listens on (default 3001)
 */
export function buildPawdCronSkillMd(bridgePort: number): string {
  const base = `http://localhost:${bridgePort}`;
  return `---
name: PAWD Cron
description: Create, list, update, and delete scheduled cron jobs for yourself. Use when you want to run on a timer, set up periodic heartbeats, or schedule a one-shot future task.
version: ${PAWD_CRON_VERSION}
category: workspace
---

# PAWD Cron Skill

This skill teaches you how to manage your own cron (scheduled) jobs via the
bridge API. You can create recurring heartbeats, interval-based timers, or
one-shot future runs — all for yourself.

**Bridge base URL:** \`${base}\`

---

## When to Use This Skill

- You want to **schedule yourself** to run at a specific time or interval
- You want to **create a recurring check** (e.g. every 10 minutes, every hour)
- You want to **list** your current cron jobs to see what's scheduled
- You want to **pause, resume, update, or delete** one of your jobs
- A task asks you to "check back later" or "retry in N minutes"

---

## 1. API Endpoints

All endpoints accept and return JSON. Use \`curl\` or \`fetch\` via the Bash tool.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET    | \`${base}/api/cron/jobs\` | List all cron jobs |
| POST   | \`${base}/api/cron/jobs\` | Create a new cron job |
| PUT    | \`${base}/api/cron/jobs/:id\` | Update a cron job |
| DELETE | \`${base}/api/cron/jobs/:id\` | Delete a cron job |
| POST   | \`${base}/api/cron/jobs/:id/run\` | Trigger an immediate run |

---

## 2. Job Schema

\`\`\`json
{
  "name": "My Recurring Check",
  "schedule": { "kind": "cron", "expr": "*/30 * * * *" },
  "sessionTarget": "heartbeat",
  "payload": {
    "kind": "systemEvent",
    "text": "Check your HEARTBEAT.md and scan for any assigned tasks."
  },
  "agentId": "<your agent ID>",
  "enabled": true
}
\`\`\`

### Schedule Kinds

| Kind | Fields | Description |
|------|--------|-------------|
| \`cron\` | \`expr\` (cron expression) | Standard 5-field cron: minute hour day month weekday |
| \`interval\` | \`everyMs\` (milliseconds) | Fire every N milliseconds |
| \`once\` | \`at\` (ISO timestamp) | Fire once at a specific time, then auto-disable |

### Cron Expression Quick Reference

| Expression | Meaning |
|------------|---------|
| \`* * * * *\` | Every minute |
| \`*/5 * * * *\` | Every 5 minutes |
| \`*/30 * * * *\` | Every 30 minutes |
| \`0 * * * *\` | Every hour (at minute 0) |
| \`0 */2 * * *\` | Every 2 hours |
| \`0 9 * * *\` | Daily at 9:00 AM |
| \`0 9 * * 1-5\` | Weekdays at 9:00 AM |
| \`0 0 * * 0\` | Weekly on Sunday at midnight |

Fields: \`minute(0-59) hour(0-23) day(1-31) month(1-12) weekday(0-6, 0=Sun)\`

Supports: \`*\`, \`*/N\`, \`N\`, \`N-M\`, \`N,M,O\`

---

## 3. Creating a Job

### Recurring heartbeat (every 30 minutes)

\`\`\`bash
curl -s -X POST ${base}/api/cron/jobs \\
  -H 'Content-Type: application/json' \\
  -d '{
    "name": "Hourly task scan",
    "schedule": { "kind": "cron", "expr": "0 * * * *" },
    "sessionTarget": "heartbeat",
    "payload": { "kind": "systemEvent", "text": "Scan for new tasks and process pending work." },
    "agentId": "<YOUR_AGENT_ID>",
    "enabled": true
  }'
\`\`\`

### Interval-based (every 5 minutes)

\`\`\`bash
curl -s -X POST ${base}/api/cron/jobs \\
  -H 'Content-Type: application/json' \\
  -d '{
    "name": "Frequent monitor",
    "schedule": { "kind": "interval", "everyMs": 300000 },
    "sessionTarget": "heartbeat",
    "payload": { "kind": "systemEvent", "text": "Check monitoring dashboard for alerts." },
    "agentId": "<YOUR_AGENT_ID>",
    "enabled": true
  }'
\`\`\`

### One-shot (run once at a specific time)

\`\`\`bash
curl -s -X POST ${base}/api/cron/jobs \\
  -H 'Content-Type: application/json' \\
  -d '{
    "name": "Retry deploy check",
    "schedule": { "kind": "once", "at": "2026-02-28T15:00:00Z" },
    "sessionTarget": "heartbeat",
    "payload": { "kind": "systemEvent", "text": "Re-check the deploy status for PR #42." },
    "agentId": "<YOUR_AGENT_ID>",
    "deleteAfterRun": true,
    "enabled": true
  }'
\`\`\`

---

## 4. Listing Your Jobs

\`\`\`bash
curl -s ${base}/api/cron/jobs | jq '.jobs[] | select(.agentId == "<YOUR_AGENT_ID>")'
\`\`\`

---

## 5. Updating a Job

\`\`\`bash
# Pause a job
curl -s -X PUT ${base}/api/cron/jobs/<JOB_ID> \\
  -H 'Content-Type: application/json' \\
  -d '{ "enabled": false }'

# Change schedule
curl -s -X PUT ${base}/api/cron/jobs/<JOB_ID> \\
  -H 'Content-Type: application/json' \\
  -d '{ "schedule": { "kind": "cron", "expr": "*/15 * * * *" } }'

# Update the message
curl -s -X PUT ${base}/api/cron/jobs/<JOB_ID> \\
  -H 'Content-Type: application/json' \\
  -d '{ "payload": { "kind": "systemEvent", "text": "New instructions here." } }'
\`\`\`

---

## 6. Deleting a Job

\`\`\`bash
curl -s -X DELETE ${base}/api/cron/jobs/<JOB_ID>
\`\`\`

---

## 7. Triggering an Immediate Run

\`\`\`bash
curl -s -X POST ${base}/api/cron/jobs/<JOB_ID>/run
\`\`\`

This fires the job right now, regardless of its schedule.

---

## 8. Common Patterns

### "Check back in 10 minutes"

When a task tells you to retry later:

\`\`\`bash
curl -s -X POST ${base}/api/cron/jobs \\
  -H 'Content-Type: application/json' \\
  -d '{
    "name": "Retry: <task description>",
    "schedule": { "kind": "interval", "everyMs": 600000 },
    "sessionTarget": "heartbeat",
    "payload": { "kind": "systemEvent", "text": "Retry task <task_id>: <what to check>." },
    "agentId": "<YOUR_AGENT_ID>",
    "deleteAfterRun": true,
    "enabled": true
  }'
\`\`\`

### Adjust your own heartbeat frequency

List your jobs, find the heartbeat job, and update its schedule:

\`\`\`bash
# Find your heartbeat job
curl -s ${base}/api/cron/jobs | jq '.jobs[] | select(.agentId == "<YOUR_AGENT_ID>" and (.name | test("Heartbeat")))'

# Update to every 15 minutes
curl -s -X PUT ${base}/api/cron/jobs/<JOB_ID> \\
  -H 'Content-Type: application/json' \\
  -d '{ "schedule": { "kind": "cron", "expr": "*/15 * * * *" } }'
\`\`\`

---

## Quick Reference

| Action | Command |
|--------|---------|
| List all jobs | \`curl -s ${base}/api/cron/jobs\` |
| Create job | \`curl -s -X POST ${base}/api/cron/jobs -H 'Content-Type: application/json' -d '{...}'\` |
| Update job | \`curl -s -X PUT ${base}/api/cron/jobs/<ID> -H 'Content-Type: application/json' -d '{...}'\` |
| Delete job | \`curl -s -X DELETE ${base}/api/cron/jobs/<ID>\` |
| Run now | \`curl -s -X POST ${base}/api/cron/jobs/<ID>/run\` |
| Pause job | Update with \`{ "enabled": false }\` |
| Resume job | Update with \`{ "enabled": true }\` |
`;
}

/**
 * Build the _meta.json content for the pawd-cron skill.
 */
export function buildPawdCronMetaJson(): string {
  return JSON.stringify(
    {
      ownerId: 'pawd-system',
      slug: 'pawd-cron',
      version: PAWD_CRON_VERSION,
      publishedAt: Date.now(),
    },
    null,
    2
  ) + '\n';
}
