/**
 * Agent Workspace Management — SDK-specific workspace scaffolding.
 *
 * Each agent gets an isolated workspace at dataDir/workspaces/{agentId}/
 * containing a .claude/ directory with skills, a CLAUDE.md file, and
 * identity context files used to build the system prompt.
 *
 * This module is independent of the existing store/workspace.ts and is
 * specifically tailored for the Claude SDK adapter.
 */

import { join } from 'path';
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'fs';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { getAgentById, updateAgent } from '../store/entities/agents.js';
import {
  buildSoulContent,
  buildIdentityContent,
  buildHeartbeatContent,
  buildToolsContent,
  buildMemoryContent,
  buildUserContent,
  buildBootstrapContent,
  getTasksDirPath,
} from '../templates/heartbeat.js';
import {
  PAWD_TASKS_SKILL_ID,
  buildPawdTasksSkillMd,
  buildPawdTasksMetaJson,
} from '../templates/skills/pawd-tasks.js';
import {
  PAWD_CRON_SKILL_ID,
  buildPawdCronSkillMd,
  buildPawdCronMetaJson,
} from '../templates/skills/pawd-cron.js';
import {
  PAWD_MEMORY_SKILL_ID,
  buildPawdMemorySkillMd,
  buildPawdMemoryMetaJson,
} from '../templates/skills/pawd-memory.js';
import {
  PAWD_AGENT_BUILDER_SKILL_ID,
  buildPawdAgentBuilderSkillMd,
  buildPawdAgentBuilderMetaJson,
} from '../templates/skills/pawd-agent-builder.js';
import {
  PAWD_SELF_IMPROVE_SKILL_ID,
  buildPawdSelfImproveSkillMd,
  buildPawdSelfImproveMetaJson,
} from '../templates/skills/pawd-self-improve.js';
import {
  PAWD_WEBHOOKS_SKILL_ID,
  buildPawdWebhooksSkillMd,
  buildPawdWebhooksMetaJson,
} from '../templates/skills/pawd-webhooks.js';

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function workspacesRoot(): string {
  return join(config.dataDir, 'workspaces');
}

/** Absolute path to an agent's workspace directory. */
export function agentWorkspacePath(agentId: string): string {
  return join(workspacesRoot(), agentId);
}

/** Path to the .claude/ subdirectory inside a workspace. */
function claudeDir(agentId: string): string {
  return join(agentWorkspacePath(agentId), '.claude');
}

/** Path to the skills directory. */
function skillsDir(agentId: string): string {
  return join(claudeDir(agentId), 'skills');
}

// ---------------------------------------------------------------------------
// Shared content
// ---------------------------------------------------------------------------

function buildClaudeMdContent(): string {
  return [
    '# Agent Workspace',
    '',
    'Read these files to orient yourself:',
    '',
    '1. **SOUL.md** — your principles (start here)',
    '2. **IDENTITY.md** — your role + identity fields',
    '3. **MEMORY.md** — notes from past sessions',
    '4. **HEARTBEAT.md** — your work rhythm',
    '5. **TOOLS.md** — capabilities and formats',
    '6. **USER.md** — your human\'s preferences',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Workspace lifecycle
// ---------------------------------------------------------------------------

/**
 * Ensure the workspace directory structure exists for an agent.
 * Creates all subdirectories and a default CLAUDE.md if missing.
 * Idempotent — never overwrites existing files.
 */
export function ensureAgentWorkspace(agentId: string): string {
  const wsDir = agentWorkspacePath(agentId);

  mkdirSync(wsDir, { recursive: true });
  mkdirSync(claudeDir(agentId), { recursive: true });
  mkdirSync(skillsDir(agentId), { recursive: true });

  // .claude/settings.json — required for SDK permission bypass and features
  const settingsPath = join(claudeDir(agentId), 'settings.json');
  if (!existsSync(settingsPath)) {
    writeFileSync(
      settingsPath,
      JSON.stringify(
        {
          permissions: {
            allow: [
              'Bash(*)',
              'Read(*)',
              'Write(*)',
              'Edit(*)',
              'Glob(*)',
              'Grep(*)',
              'WebSearch(*)',
              'WebFetch(*)',
              'Task(*)',
              'TaskOutput(*)',
              'Skill(*)',
              'NotebookEdit(*)',
            ],
          },
          env: {
            CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
          },
        },
        null,
        2,
      ) + '\n',
      'utf-8',
    );
    logger.debug({ agentId, path: settingsPath }, 'Created .claude/settings.json');
  }

  // Default CLAUDE.md (only if missing)
  const claudeMdPath = join(wsDir, 'CLAUDE.md');
  if (!existsSync(claudeMdPath)) {
    writeFileSync(claudeMdPath, buildClaudeMdContent(), 'utf-8');
    logger.debug({ agentId, path: claudeMdPath }, 'Created default CLAUDE.md');
  }

  // Scaffold identity files (SOUL.md, IDENTITY.md, HEARTBEAT.md, etc.)
  // These are used by buildSystemPromptAppend() to inject into the system prompt.
  // Only written if missing — never overwrites user/agent edits.
  const agent = getAgentById(agentId);
  if (agent) {
    const identityTemplates: Record<string, string> = {
      'SOUL.md': buildSoulContent(agent.name),
      'IDENTITY.md': buildIdentityContent(agent),
      'HEARTBEAT.md': buildHeartbeatContent(agentId, agent.name),
      'TOOLS.md': buildToolsContent(),
      'MEMORY.md': buildMemoryContent(agent.name),
      'USER.md': buildUserContent(agent.name),
      'BOOTSTRAP.md': buildBootstrapContent(agent.name),
    };

    let created = 0;
    for (const [filename, content] of Object.entries(identityTemplates)) {
      const filepath = join(wsDir, filename);
      if (!existsSync(filepath)) {
        writeFileSync(filepath, content, 'utf-8');
        created++;
      }
    }

    if (created > 0) {
      logger.debug({ agentId, created }, 'Scaffolded identity files in SDK workspace');
    }
  }

  // Install default Pawd skills (idempotent — only writes if missing)
  installDefaultSkills(agentId);

  return wsDir;
}

/**
 * Install default Pawd skills into an agent's .claude/skills/ directory.
 * Idempotent — only writes if the skill directory doesn't exist yet.
 */
function installDefaultSkills(agentId: string): void {
  // pawd-tasks skill
  const pawdDir = join(skillsDir(agentId), PAWD_TASKS_SKILL_ID);
  if (!existsSync(pawdDir)) {
    mkdirSync(pawdDir, { recursive: true });
    const tasksDir = getTasksDirPath();
    writeFileSync(join(pawdDir, 'SKILL.md'), buildPawdTasksSkillMd(tasksDir), 'utf-8');
    writeFileSync(join(pawdDir, '_meta.json'), buildPawdTasksMetaJson(), 'utf-8');
    logger.debug({ agentId, skillId: PAWD_TASKS_SKILL_ID }, 'Installed default pawd-tasks skill');
  }

  // pawd-cron skill
  const cronDir = join(skillsDir(agentId), PAWD_CRON_SKILL_ID);
  if (!existsSync(cronDir)) {
    mkdirSync(cronDir, { recursive: true });
    writeFileSync(join(cronDir, 'SKILL.md'), buildPawdCronSkillMd(config.port), 'utf-8');
    writeFileSync(join(cronDir, '_meta.json'), buildPawdCronMetaJson(), 'utf-8');
    logger.debug({ agentId, skillId: PAWD_CRON_SKILL_ID }, 'Installed default pawd-cron skill');
  }

  // pawd-memory skill
  const memoryDir = join(skillsDir(agentId), PAWD_MEMORY_SKILL_ID);
  if (!existsSync(memoryDir)) {
    mkdirSync(memoryDir, { recursive: true });
    writeFileSync(join(memoryDir, 'SKILL.md'), buildPawdMemorySkillMd(config.port), 'utf-8');
    writeFileSync(join(memoryDir, '_meta.json'), buildPawdMemoryMetaJson(), 'utf-8');
    logger.debug({ agentId, skillId: PAWD_MEMORY_SKILL_ID }, 'Installed default pawd-memory skill');
  }

  // pawd-agent-builder skill
  const builderDir = join(skillsDir(agentId), PAWD_AGENT_BUILDER_SKILL_ID);
  if (!existsSync(builderDir)) {
    mkdirSync(builderDir, { recursive: true });
    writeFileSync(join(builderDir, 'SKILL.md'), buildPawdAgentBuilderSkillMd(config.port), 'utf-8');
    writeFileSync(join(builderDir, '_meta.json'), buildPawdAgentBuilderMetaJson(), 'utf-8');
    logger.debug({ agentId, skillId: PAWD_AGENT_BUILDER_SKILL_ID }, 'Installed default pawd-agent-builder skill');
  }

  // pawd-self-improve skill
  const selfImproveDir = join(skillsDir(agentId), PAWD_SELF_IMPROVE_SKILL_ID);
  if (!existsSync(selfImproveDir)) {
    mkdirSync(selfImproveDir, { recursive: true });
    writeFileSync(join(selfImproveDir, 'SKILL.md'), buildPawdSelfImproveSkillMd(config.port), 'utf-8');
    writeFileSync(join(selfImproveDir, '_meta.json'), buildPawdSelfImproveMetaJson(), 'utf-8');
    logger.debug({ agentId, skillId: PAWD_SELF_IMPROVE_SKILL_ID }, 'Installed default pawd-self-improve skill');
  }

  // pawd-webhooks skill
  const webhooksDir = join(skillsDir(agentId), PAWD_WEBHOOKS_SKILL_ID);
  if (!existsSync(webhooksDir)) {
    mkdirSync(webhooksDir, { recursive: true });
    writeFileSync(join(webhooksDir, 'SKILL.md'), buildPawdWebhooksSkillMd(config.port), 'utf-8');
    writeFileSync(join(webhooksDir, '_meta.json'), buildPawdWebhooksMetaJson(), 'utf-8');
    logger.debug({ agentId, skillId: PAWD_WEBHOOKS_SKILL_ID }, 'Installed default pawd-webhooks skill');
  }
}

/**
 * Force-refresh the CLAUDE.md and any missing identity files for an agent.
 * Unlike ensureAgentWorkspace, this ALWAYS rewrites CLAUDE.md (to pick up
 * new soul-aware content) and scaffolds any missing identity files.
 * Useful after template updates or to fix stale workspaces.
 */
export function refreshAgentWorkspace(agentId: string): void {
  const wsDir = ensureAgentWorkspace(agentId);

  // Always rewrite CLAUDE.md with current content
  const claudeMdPath = join(wsDir, 'CLAUDE.md');
  writeFileSync(claudeMdPath, buildClaudeMdContent(), 'utf-8');
  logger.debug({ agentId }, 'Refreshed CLAUDE.md in SDK workspace');
}

/** Remove an agent's entire workspace directory. */
export function removeAgentWorkspace(agentId: string): boolean {
  const wsDir = agentWorkspacePath(agentId);
  if (!existsSync(wsDir)) return false;

  rmSync(wsDir, { recursive: true, force: true });
  logger.debug({ agentId }, 'Removed SDK agent workspace');
  return true;
}

// ---------------------------------------------------------------------------
// CLAUDE.md (identity / soul)
// ---------------------------------------------------------------------------

/** Read the CLAUDE.md file for an agent. Returns empty string if missing. */
export function readClaudeMd(agentId: string): string {
  const filepath = join(agentWorkspacePath(agentId), 'CLAUDE.md');
  if (!existsSync(filepath)) return '';
  return readFileSync(filepath, 'utf-8');
}

/** Overwrite the CLAUDE.md file for an agent. Creates workspace if needed. */
export function writeClaudeMd(agentId: string, content: string): void {
  ensureAgentWorkspace(agentId);
  const filepath = join(agentWorkspacePath(agentId), 'CLAUDE.md');
  writeFileSync(filepath, content, 'utf-8');
  logger.debug({ agentId }, 'Wrote CLAUDE.md');
}

// ---------------------------------------------------------------------------
// Identity files (SOUL.md, IDENTITY.md, HEARTBEAT.md, MEMORY.md)
// ---------------------------------------------------------------------------

const IDENTITY_FILES = ['SOUL.md', 'IDENTITY.md', 'HEARTBEAT.md', 'MEMORY.md'] as const;
type IdentityFile = (typeof IDENTITY_FILES)[number];

/** Read an identity file from the agent workspace. */
export function readIdentityFile(agentId: string, filename: IdentityFile): string {
  const filepath = join(agentWorkspacePath(agentId), filename);
  if (!existsSync(filepath)) return '';
  return readFileSync(filepath, 'utf-8');
}

/** Write an identity file to the agent workspace. */
export function writeIdentityFile(agentId: string, filename: IdentityFile, content: string): void {
  ensureAgentWorkspace(agentId);
  const filepath = join(agentWorkspacePath(agentId), filename);
  writeFileSync(filepath, content, 'utf-8');
  logger.debug({ agentId, filename }, 'Wrote identity file');
}

/**
 * Build a combined system prompt appendix from all identity files.
 * Returns the concatenation of SOUL.md + IDENTITY.md + HEARTBEAT.md + MEMORY.md
 * content, each separated by a newline. Empty files are skipped.
 */
export function buildSystemPromptAppend(agentId: string): string {
  const parts: string[] = [];

  for (const filename of IDENTITY_FILES) {
    const content = readIdentityFile(agentId, filename);
    if (content.trim()) {
      parts.push(content.trim());
    }
  }

  return parts.length > 0 ? parts.join('\n\n') : '';
}

// ---------------------------------------------------------------------------
// Skills CRUD
// ---------------------------------------------------------------------------

export interface WorkspaceSkill {
  /** Skill directory name (used as ID). */
  id: string;
  /** Skill markdown content (from SKILL.md). */
  content: string;
}

/** List all skills in the agent's .claude/skills/ directory. */
export function listSkills(agentId: string): WorkspaceSkill[] {
  const dir = skillsDir(agentId);
  if (!existsSync(dir)) return [];

  const entries = readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  const results: WorkspaceSkill[] = [];
  for (const entry of entries) {
    const skillMd = join(dir, entry, 'SKILL.md');
    let content = '';
    try {
      content = readFileSync(skillMd, 'utf-8');
    } catch {
      // SKILL.md may not exist
    }
    results.push({ id: entry, content });
  }

  return results;
}

/** Add or update a skill in the agent's workspace. */
export function addSkill(agentId: string, skillId: string, content: string): WorkspaceSkill {
  const dir = join(skillsDir(agentId), skillId);
  mkdirSync(dir, { recursive: true });

  const filepath = join(dir, 'SKILL.md');
  writeFileSync(filepath, content, 'utf-8');
  logger.debug({ agentId, skillId }, 'Added/updated workspace skill');

  return { id: skillId, content };
}

/** Remove a skill from the agent's workspace. Returns true if it existed. */
export function removeSkill(agentId: string, skillId: string): boolean {
  const dir = join(skillsDir(agentId), skillId);
  if (!existsSync(dir)) return false;

  rmSync(dir, { recursive: true, force: true });
  logger.debug({ agentId, skillId }, 'Removed workspace skill');
  return true;
}

// ---------------------------------------------------------------------------
// Self-discovery identity sync
// ---------------------------------------------------------------------------

export interface ParsedIdentity {
  creature?: string;
  vibe?: string;
  identityEmoji?: string;
  identityAvatar?: string;
}

/** Placeholder values that should be treated as "not yet filled in". */
const PLACEHOLDER_RE = /^\(not yet discovered\)$|^\(pick something you like\)$/i;

/**
 * Read IDENTITY.md from the agent's SDK workspace and extract
 * the self-discovery fields (Creature, Vibe, Emoji, Avatar) via regex.
 *
 * Returns null if the file does not exist or no real values were found.
 */
export function parseIdentityFields(agentId: string): ParsedIdentity | null {
  const filepath = join(agentWorkspacePath(agentId), 'IDENTITY.md');
  if (!existsSync(filepath)) return null;

  const content = readFileSync(filepath, 'utf-8');

  const extract = (label: string): string | undefined => {
    const re = new RegExp(`\\*\\*${label}\\*\\*:\\s*(.+)`, 'i');
    const m = content.match(re);
    if (!m) return undefined;
    const val = m[1].trim();
    if (!val || PLACEHOLDER_RE.test(val)) return undefined;
    return val;
  };

  const creature = extract('Creature');
  const vibe = extract('Vibe');
  const identityEmoji = extract('Emoji');
  const identityAvatar = extract('Avatar');

  // Return null if nothing was extracted
  if (!creature && !vibe && !identityEmoji && !identityAvatar) return null;

  return { creature, vibe, identityEmoji, identityAvatar };
}

/**
 * Parse the identity fields from the agent's IDENTITY.md and persist
 * any discovered values back to the agent data store.
 */
export function syncIdentityToAgent(agentId: string): void {
  const fields = parseIdentityFields(agentId);
  if (!fields) return;

  const agent = getAgentById(agentId);
  if (!agent) return;

  const updates: Partial<typeof agent> = {};
  if (fields.creature) updates.creature = fields.creature;
  if (fields.vibe) updates.vibe = fields.vibe;
  if (fields.identityEmoji) updates.identityEmoji = fields.identityEmoji;
  if (fields.identityAvatar) updates.identityAvatar = fields.identityAvatar;

  if (Object.keys(updates).length > 0) {
    updateAgent(agentId, updates);
    logger.debug({ agentId, updates }, 'Synced identity fields from IDENTITY.md to agent store');
  }
}
