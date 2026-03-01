/**
 * Default "pawd-tasks" skill template.
 *
 * This skill is auto-synced to every agent's workspace on boot so all
 * agents know how to create, manage, and execute PAWD tasks.
 */

export const PAWD_TASKS_SKILL_ID = 'pawd-tasks-0.1.0';
export const PAWD_TASKS_VERSION = '0.1.0';

/**
 * Build the SKILL.md content for the pawd-tasks skill.
 * @param tasksDir Absolute path to the tasks directory (e.g. ~/.pawd-bridge/data/tasks)
 */
export function buildPawdTasksSkillMd(tasksDir: string): string {
  return `---
name: PAWD Tasks
description: Create, delete, and manage PAWD tasks. Use when the user wants to add tasks, remove tasks, list tasks, change task status, or understand the task lifecycle.
version: ${PAWD_TASKS_VERSION}
category: workspace
---

# PAWD Tasks Skill

This skill teaches you how to work with PAWD tasks: creating them, deleting
them, managing task status and execution, and understanding the full task
lifecycle driven by HEARTBEAT and the Mission Scanner.

**Task folder:** \`${tasksDir}/\`
Each task is a single \`.md\` file with YAML frontmatter and a \`## Steps\` section.

**Critical rule:** When executing a task, never ask the user a follow-up
question. If you are blocked or need something answered, write it in the
task output (frontmatter \`output\` or \`## Output\` / \`## Blocked\` in the body).

---

## When to Use This Skill

Use this skill when the user (or a heartbeat check-in) requires you to:

- **Create** a new task for yourself or another agent
- **List** or **read** tasks by status, priority, or agent
- **Update** a task's status, priority, or assignee
- **Delete** or archive a task
- **Execute** a task (work through its steps)
- **Understand** how the Mission Scanner and HEARTBEAT drive task execution

---

## 1. Task File Format

Every task is a markdown file at \`${tasksDir}/{id}.md\`.

### 1.1 Required Frontmatter

| Field             | Type   | Description |
|-------------------|--------|-------------|
| \`id\`              | string | Unique task ID (e.g. \`t15\`, \`t_abc123\`) |
| \`title\`           | string | Short human-readable title |
| \`status\`          | string | \`todo\` \\| \`in_progress\` \\| \`done\` \\| \`blocked\` \\| \`waiting_for_human\` |
| \`priority\`        | string | \`urgent\` \\| \`high\` \\| \`medium\` \\| \`low\` |
| \`assignedAgentId\` | string | Agent ID that should run this task (e.g. \`a1\`) |
| \`createdAt\`       | string | ISO-8601 timestamp (e.g. \`2026-02-25T12:00:00Z\`) |

### 1.2 Optional Frontmatter

| Field            | Type   | Description |
|------------------|--------|-------------|
| \`tags\`           | array  | Labels for filtering (e.g. \`["Inbox", "Email"]\`) |
| \`dueDate\`        | string | \`YYYY-MM-DD\` or null |
| \`tokensUsed\`     | number | Set when the task is completed |
| \`tokenEstimate\`  | array  | Expected range \`[min, max]\` |
| \`completedAt\`    | string | ISO timestamp when status changed to \`done\` |
| \`startedAt\`      | string | ISO timestamp when status changed to \`in_progress\` |
| \`blockedReason\`  | string | Why the task is blocked (set when \`status: blocked\`) |
| \`notes\`          | string | Short freeform note |
| \`output\`         | string | Inline output for small results |

### 1.3 Body Structure

\`\`\`markdown
# <Title>

<Description paragraph — what this task is about and what "done" looks like.>

## Steps

- [ ] Step 1 description
- [ ] Step 2 description
- [ ] Step 3 description

## Output

<Deliverable goes here after execution.>
\`\`\`

- The H1 title must match the frontmatter \`title\`.
- \`## Steps\` contains a checklist (\`- [ ]\` unchecked, \`- [x]\` done).
- \`## Output\` is added during or after execution with the concrete result.
- \`## Blocked\` or \`## Waiting for Human\` sections are added when the task
  cannot proceed, explaining exactly what is needed.

---

## 2. Creating a Task

To create a new task:

1. **Generate an ID**: Use the pattern \`t_\` + 6-8 random lowercase alphanumeric
   characters (e.g. \`t_k7m2x9\`). The filename must be \`{id}.md\`.
2. **Write frontmatter**: Include all required fields. Set \`status: todo\`.
   Set \`createdAt\` to the current ISO timestamp.
3. **Write the body**: H1 title, description, and \`## Steps\` with checklist items.
4. **Save** the file to \`${tasksDir}/{id}.md\`.

### Example

**File:** \`${tasksDir}/t_k7m2x9.md\`

\`\`\`markdown
---
id: t_k7m2x9
title: Review PR #42 and leave feedback
status: todo
priority: high
assignedAgentId: a1
tags:
  - PR
  - Review
dueDate: '2026-02-26'
tokensUsed: null
tokenEstimate: [15000, 30000]
createdAt: '2026-02-25T20:00:00Z'
completedAt: null
---

# Review PR #42 and leave feedback

Read the diff for PR #42, run tests locally, and post concise review
comments with approval or change requests.

## Steps

- [ ] Fetch branch and run test suite
- [ ] Read diff and note style/logic issues
- [ ] Post review with suggestions and approval/request changes
\`\`\`

---

## 3. Reading and Listing Tasks

To list tasks, scan \`${tasksDir}/\` for all \`.md\` files and parse their
YAML frontmatter. You can filter by:

- **Status**: \`status: todo\` for pending work, \`status: in_progress\` for
  active work, \`status: done\` for completed, \`status: blocked\` for stuck.
- **Agent**: \`assignedAgentId\` matches a specific agent ID.
- **Priority**: \`priority\` field for ordering.
- **Tags**: \`tags\` array for category filtering.

**Sort order** (when picking the next task):
1. \`priority: urgent\` first (drop everything)
2. \`priority: high\`
3. \`priority: medium\`
4. \`priority: low\`
5. Within the same priority, pick the oldest by \`createdAt\`.

---

## 4. Updating Task Status

### Status Lifecycle

\`\`\`
todo ──> in_progress ──> done
  │          │
  │          ├──> blocked
  │          │
  │          └──> waiting_for_human
  │
  └──> (deleted)
\`\`\`

### Transition Rules

| From            | To                  | Fields to Update |
|-----------------|---------------------|------------------|
| \`todo\`          | \`in_progress\`       | \`status\`, \`startedAt\` (ISO now) |
| \`in_progress\`   | \`done\`              | \`status\`, \`completedAt\` (ISO now), \`tokensUsed\` |
| \`in_progress\`   | \`blocked\`           | \`status\`, \`blockedReason\` (explain why) |
| \`in_progress\`   | \`waiting_for_human\` | \`status\`, \`blockedReason\` (what the human needs to do) |
| \`blocked\`       | \`in_progress\`       | \`status\`, clear \`blockedReason\` |
| \`blocked\`       | \`todo\`              | \`status\`, clear \`blockedReason\` |
| \`waiting_for_human\` | \`in_progress\`  | \`status\`, clear \`blockedReason\` (human resolved the issue) |
| \`waiting_for_human\` | \`todo\`          | \`status\`, clear \`blockedReason\` (re-queued after human action) |
| \`waiting_for_human\` | \`done\`          | \`status\`, \`completedAt\`, clear \`blockedReason\` (human completed it) |

When updating status, always preserve existing frontmatter fields. Parse
the file with a YAML parser, update only the changed fields, and write back.

---

## 5. Moving Tasks to Human Help

Use \`status: waiting_for_human\` when a task **cannot be completed by an
agent alone** and requires a human to take action. This is different from
\`blocked\` (technical issue) — \`waiting_for_human\` means the task is
explicitly parked for a person to handle.

### When to Escalate

Move a task to \`waiting_for_human\` when it requires:

- **Manual approval or sign-off** — e.g. publishing, deploying to production, legal review
- **Physical-world action** — e.g. mailing a package, making a phone call
- **Account or credential setup** — e.g. creating an API key, granting permissions
- **Subjective human decision** — e.g. choosing a design, naming a product
- **Sensitive data entry** — e.g. entering payment info, passwords, personal details
- **External communication** — e.g. sending an email to a client, scheduling a meeting

### How to Escalate

1. Set \`status: waiting_for_human\` in frontmatter
2. Set \`blockedReason\` with a **clear, actionable description** of what the human
   needs to do — be specific enough that they can act without guessing
3. Add a \`## Waiting for Human\` section in the body with:
   - What the agent already completed
   - Exactly what the human needs to do
   - Any relevant links, references, or context
   - What happens after the human acts (next steps)
4. Update \`MEMORY.md\` > \`## Blocked Tasks Log\` with the escalation

### Example

\`\`\`markdown
---
id: t_r9w3k1
title: Deploy v2.1 to production
status: waiting_for_human
priority: high
assignedAgentId: a1
blockedReason: "Needs manual approval to deploy to production environment"
createdAt: '2026-02-25T14:00:00Z'
startedAt: '2026-02-25T14:05:00Z'
---

# Deploy v2.1 to production

Build, test, and deploy version 2.1 to the production environment.

## Steps

- [x] Run full test suite (2026-02-25T14:10:00Z)
- [x] Build production bundle (2026-02-25T14:15:00Z)
- [ ] Deploy to production (waiting for human approval)

## Waiting for Human

All tests pass and the production build is ready.

**What you need to do:** Approve the production deployment by running
\\\`deploy --env production --version 2.1\\\` or confirm in the deploy dashboard.

**Context:** Changelog and test results are in the task output below.
\`\`\`

### Resuming After Human Action

When the human completes their part:
- Set \`status: in_progress\` and clear \`blockedReason\` to resume agent work
- Or set \`status: done\` with \`completedAt\` if the human action completed the task
- Or set \`status: todo\` to re-queue for the agent to pick up on next heartbeat

---

## 6. Working Through Steps

When executing a task:

1. Set \`status: in_progress\` and \`startedAt\` to the current ISO timestamp.
2. Read the \`## Steps\` section carefully.
3. Work through each step sequentially.
4. As you complete each step, change \`- [ ]\` to \`- [x]\` and append a
   timestamp: \`- [x] Step description (2026-02-25T20:15:00Z)\`.
5. Save the file after each step so progress is visible.
6. If a step is unclear, make your best judgment and note your interpretation
   in the \`## Output\` section.
7. If a step is impossible, set \`status: blocked\` with \`blockedReason\`.
8. If a step requires human action, set \`status: waiting_for_human\` with
   \`blockedReason\` (see section 5 above).

---

## 7. Writing Output

When all steps are complete (or when you have partial results to report):

1. Add or update the \`## Output\` section at the end of the task body.
2. Write the concrete deliverable — findings, generated content, code, analysis.
3. Be thorough. This is the primary artifact the user reviews.
4. Include actual results, not summaries of what you did.
5. For large output that would make the task file unwieldy, create a sidecar
   file at \`${tasksDir}/{id}-output.md\` and reference it from the task.

---

## 8. Deleting Tasks

- **Soft delete (preferred):** Set \`status: done\` and add
  \`notes: "Cancelled by user"\` or \`notes: "Archived"\`. The Mission Scanner
  only picks \`status: todo\`, so done/blocked tasks are skipped.
- **Hard delete:** Remove the file from \`${tasksDir}/\`. The task is gone
  permanently. Only do this when the user explicitly requests deletion.

Prefer soft delete to preserve history. Use hard delete only when the task
must disappear entirely.

---

## 9. How Task Execution Works (Mission Scanner)

Task execution is driven by **HEARTBEAT**: when an agent receives a
heartbeat, it reads \`HEARTBEAT.md\` in its workspace. The HEARTBEAT defines
a Mission Scanner that:

1. **Scans** all \`.md\` files in \`${tasksDir}/\`.
2. **Filters** tasks where \`assignedAgentId\` matches this agent and
   \`status\` is \`todo\` (or resumes \`in_progress\` tasks first).
3. **Orders** by priority (urgent > high > medium > low), then oldest
   \`createdAt\`.
4. **Executes** the chosen task: sets \`in_progress\`, works through steps,
   writes output, sets \`done\` + \`completedAt\` + \`tokensUsed\`.
5. **Skips** if the agent already has an \`in_progress\` task (finish it first),
   or if the task file is malformed.
6. **Skips** tasks with \`status: waiting_for_human\` — these are parked
   for the human and should not be picked up by the agent until the human
   changes the status back.

**Never ask follow-up questions during execution.** If blocked, set
\`status: blocked\` with \`blockedReason\` and move to the next task. If the
task needs human action, set \`status: waiting_for_human\` with \`blockedReason\`.

---

## 10. Adding This Skill to an Agent

### 10.1 Add to the Agent Profile

Edit the agent's markdown file (e.g. \`.pawd-bridge/workspaces/{agentId}/IDENTITY.md\`).
In the **Skills** section, add:

\`\`\`markdown
- **PAWD Tasks** (workspace) - Create, delete, and manage PAWD tasks; understand task lifecycle and HEARTBEAT mission scanner. [enabled]
\`\`\`

### 10.2 Wire Task Execution via HEARTBEAT

Ensure the agent's \`HEARTBEAT.md\` (in its workspace) includes Mission Scanner
instructions pointing to \`${tasksDir}/\` with the agent's ID.

**Summary:**
- **Skill on agent** = agent can create/delete/explain tasks and add the
  skill to other agents.
- **HEARTBEAT + Mission Scanner** = agent picks and runs tasks from
  \`${tasksDir}/\` on each heartbeat.

---

## Quick Reference

| Action | How |
|--------|-----|
| Create task | Write \`{id}.md\` to \`${tasksDir}/\` with frontmatter + steps |
| List tasks | Scan \`${tasksDir}/*.md\`, parse frontmatter |
| Start task | Set \`status: in_progress\`, \`startedAt\` |
| Complete task | Set \`status: done\`, \`completedAt\`, \`tokensUsed\` |
| Block task | Set \`status: blocked\`, \`blockedReason\` |
| Escalate to human | Set \`status: waiting_for_human\`, \`blockedReason\` (what human needs to do) |
| Resume from human | Set \`status: in_progress\`, clear \`blockedReason\` |
| Delete task | Remove file (hard) or set \`status: done\` + notes (soft) |
| Check steps | Toggle \`- [ ]\` to \`- [x]\` with timestamp |
| Write output | Add \`## Output\` section with concrete results |
`;
}

/**
 * Build the _meta.json content for the pawd-tasks skill.
 */
export function buildPawdTasksMetaJson(): string {
  return JSON.stringify(
    {
      ownerId: 'pawd-system',
      slug: 'pawd-tasks',
      version: PAWD_TASKS_VERSION,
      publishedAt: Date.now(),
    },
    null,
    2
  ) + '\n';
}
