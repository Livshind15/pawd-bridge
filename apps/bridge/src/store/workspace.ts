import { join } from 'path';
import { existsSync, mkdirSync, writeFileSync, readdirSync, readFileSync, rmSync } from 'fs';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import type { AgentData, SkillData } from './markdown/serializer.js';
import matter from 'gray-matter';
import {
  buildHeartbeatContent,
  buildIdentityContent,
  buildSoulContent,
  buildToolsContent,
  buildMemoryContent,
  buildUserContent,
  buildBootstrapContent,
} from '../templates/heartbeat.js';

/**
 * Agent workspace management — manages per-agent workspace directories
 * under agentWorkspacesDir (typically ~/.pawd-bridge/workspaces/).
 *
 * Provides workspace scaffolding, identity files, and agent registry.
 */

/** Directory for per-agent workspaces. */
function agentWorkspacesDir(): string {
  return config.agentWorkspacesDir;
}

/** Get the workspace path for a specific agent. */
export function getAgentWorkspacePath(agentId: string): string {
  return join(agentWorkspacesDir(), agentId);
}

/**
 * Sync agent data to a workspace-level agent file.
 * When agents are created/updated, a summary markdown file is written
 * so other tooling can discover agent definitions.
 */
export function syncAgentToWorkspace(agent: AgentData): void {
  try {
    const dir = join(agentWorkspacesDir(), '_registry');
    mkdirSync(dir, { recursive: true });

    const filepath = join(dir, `${agent.id}.md`);
    const content = buildAgentWorkspaceFile(agent);
    writeFileSync(filepath, content, 'utf-8');
    logger.debug({ agentId: agent.id, path: filepath }, 'Synced agent to workspace registry');
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), agentId: agent.id },
      'Failed to sync agent to workspace'
    );
  }
}

/** Remove an agent file from the workspace registry. */
export function removeAgentFromWorkspace(agentId: string): void {
  try {
    const filepath = join(agentWorkspacesDir(), '_registry', `${agentId}.md`);
    if (existsSync(filepath)) {
      rmSync(filepath, { force: true });
      logger.debug({ agentId, path: filepath }, 'Removed agent from workspace registry');
    }
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), agentId },
      'Failed to remove agent from workspace registry'
    );
  }
}

/** Load workspace skill summaries from agent workspace skills directories. */
export function loadWorkspaceSkillIds(): SkillData[] {
  try {
    // Check for a shared skills directory in the workspaces root
    const skillsDir = join(agentWorkspacesDir(), '_skills');
    if (!existsSync(skillsDir)) return [];

    const entries = readdirSync(skillsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    const results: SkillData[] = [];
    for (const dir of entries) {
      const skillMdPath = join(skillsDir, dir, 'SKILL.md');
      let name = dir;
      let description = '';
      try {
        const content = readFileSync(skillMdPath, 'utf-8');
        const parsed = matter(content);
        name = (parsed.data as Record<string, unknown>).name as string ?? dir;
        description = (parsed.data as Record<string, unknown>).description as string ?? '';
      } catch {
        // SKILL.md missing
      }
      results.push({
        id: dir,
        name,
        icon: 'sparkles',
        description,
        category: 'workspace',
        enabled: true,
        tokenCostHint: '',
      });
    }
    return results;
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'Failed to load workspace skills');
    return [];
  }
}

/**
 * Rebuild the AGENTS.md registry in the workspaces root.
 * Called after any agent create/update/delete and on boot sync.
 */
export function syncAgentsRegistry(agents: AgentData[]): void {
  try {
    mkdirSync(agentWorkspacesDir(), { recursive: true });
    const sorted = [...agents].sort((a, b) => a.name.localeCompare(b.name));
    const lines: string[] = [
      '# AGENTS',
      'This directory tracks agent workspaces and their capabilities.',
    ];
    for (const a of sorted) {
      const summary = a.tagline || a.description || a.role;
      lines.push(`- ${a.name}: ${summary} (${a.roleLabel || a.role})`);
    }
    const filepath = join(agentWorkspacesDir(), 'AGENTS.md');
    writeFileSync(filepath, lines.join('\n') + '\n', 'utf-8');
    logger.debug({ count: agents.length, path: filepath }, 'Rebuilt AGENTS.md registry');
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'Failed to rebuild AGENTS.md registry'
    );
  }
}

/** Default content for workspace identity files (created only if missing). */
const DEFAULT_WORKSPACE_FILES: Record<string, string> = {
  'IDENTITY.md': '# Identity\n\nDescribe the agent\'s persona here.\n',
  'SOUL.md': '# Soul\n\nCore principles and boundaries.\n',
  'USER.md': '# User\n\nHuman profile and preferences.\n',
  'TOOLS.md': '# Tools\n\nEnvironment-specific tool notes.\n',
  'BOOTSTRAP.md': '# Bootstrap\n\nFirst-run onboarding steps.\n',
  'HEARTBEAT.md': '# Heartbeat\n\nPeriodic tasks.\n',
  'MEMORY.md': '# Memory\n\nTemporary memory log.\n',
};

/**
 * Ensure all 7 workspace identity files exist.
 * Creates missing files with minimal templates — never overwrites existing.
 */
export function ensureDefaultWorkspaceFiles(): void {
  try {
    mkdirSync(agentWorkspacesDir(), { recursive: true });
    let created = 0;

    for (const [filename, content] of Object.entries(DEFAULT_WORKSPACE_FILES)) {
      const filepath = join(agentWorkspacesDir(), filename);
      if (!existsSync(filepath)) {
        writeFileSync(filepath, content, 'utf-8');
        created++;
      }
    }

    if (created > 0) {
      logger.debug({ created }, 'Created default workspace identity files');
    }
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'Failed to ensure default workspace files'
    );
  }
}

/** List of allowed workspace identity file names (for API validation). */
export const WORKSPACE_IDENTITY_FILES = Object.keys(DEFAULT_WORKSPACE_FILES);

/**
 * Ensure heartbeat config exists in the bridge data directory.
 * No-op stub — heartbeat scheduling is now handled locally.
 */
export function ensureHeartbeatConfig(): void {
  // Heartbeat config is now managed through local cron jobs.
  // This function is kept for backward compatibility with callers.
  logger.debug('ensureHeartbeatConfig: heartbeat is managed via local cron jobs');
}

/**
 * Create the per-agent workspace directory with identity + HEARTBEAT files.
 * Only writes files that don't already exist (never overwrites).
 */
export function ensureAgentWorkspace(agent: AgentData): void {
  try {
    const wsDir = getAgentWorkspacePath(agent.id);
    mkdirSync(wsDir, { recursive: true });

    // All workspace files (7 core + AGENTS.md registry)
    const files: Record<string, string> = {
      'IDENTITY.md': buildIdentityContent(agent),
      'SOUL.md': buildSoulContent(agent.name),
      'HEARTBEAT.md': buildHeartbeatContent(agent.id, agent.name),
      'TOOLS.md': buildToolsContent(),
      'MEMORY.md': buildMemoryContent(agent.name),
      'USER.md': buildUserContent(agent.name),
      'BOOTSTRAP.md': buildBootstrapContent(agent.name),
      'AGENTS.md': `# AGENTS\n\nThis agent workspace belongs to **${agent.name}** (${agent.roleLabel || agent.role}).\n`,
    };

    let created = 0;
    for (const [filename, content] of Object.entries(files)) {
      const filepath = join(wsDir, filename);
      if (!existsSync(filepath)) {
        writeFileSync(filepath, content, 'utf-8');
        created++;
      }
    }

    // Create subdirectories
    mkdirSync(join(wsDir, 'agents'), { recursive: true });
    mkdirSync(join(wsDir, 'skills'), { recursive: true });
    mkdirSync(join(wsDir, 'memory'), { recursive: true });

    if (created > 0) {
      logger.info({ agentId: agent.id, wsDir, created }, 'Created per-agent workspace');
    }
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), agentId: agent.id },
      'Failed to create agent workspace'
    );
  }
}

/**
 * Remove the per-agent workspace directory.
 */
export function removeAgentWorkspace(agentId: string): void {
  try {
    const wsDir = getAgentWorkspacePath(agentId);
    if (existsSync(wsDir)) {
      rmSync(wsDir, { recursive: true, force: true });
      logger.info({ agentId, wsDir }, 'Removed agent workspace');
    }
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), agentId },
      'Failed to remove agent workspace'
    );
  }
}

/**
 * Regenerate the IDENTITY.md for an agent.
 * Unlike ensureAgentWorkspace (which never overwrites), this ALWAYS rewrites
 * the file so the identity name stays in sync with the agent's current name.
 */
export function updateAgentIdentity(agent: AgentData): void {
  try {
    const wsDir = getAgentWorkspacePath(agent.id);
    if (!existsSync(wsDir)) {
      mkdirSync(wsDir, { recursive: true });
    }

    const filepath = join(wsDir, 'IDENTITY.md');
    writeFileSync(filepath, buildIdentityContent(agent), 'utf-8');
    logger.debug({ agentId: agent.id, name: agent.name }, 'Updated agent IDENTITY.md');
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), agentId: agent.id },
      'Failed to update agent IDENTITY.md'
    );
  }
}

/**
 * Regenerate the HEARTBEAT.md for an agent (e.g. after a name change).
 */
export function updateAgentHeartbeat(agent: AgentData): void {
  try {
    const wsDir = getAgentWorkspacePath(agent.id);
    if (!existsSync(wsDir)) return;

    const filepath = join(wsDir, 'HEARTBEAT.md');
    writeFileSync(filepath, buildHeartbeatContent(agent.id, agent.name), 'utf-8');
    logger.debug({ agentId: agent.id }, 'Updated agent HEARTBEAT.md');
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), agentId: agent.id },
      'Failed to update agent HEARTBEAT.md'
    );
  }
}

/**
 * Regenerate the SOUL.md for an agent (e.g. after a name or soul update).
 */
export function updateAgentSoul(agent: AgentData): void {
  try {
    const wsDir = getAgentWorkspacePath(agent.id);
    if (!existsSync(wsDir)) {
      mkdirSync(wsDir, { recursive: true });
    }

    const filepath = join(wsDir, 'SOUL.md');
    writeFileSync(filepath, buildSoulContent(agent.name), 'utf-8');
    logger.debug({ agentId: agent.id, name: agent.name }, 'Updated agent SOUL.md');
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), agentId: agent.id },
      'Failed to update agent SOUL.md'
    );
  }
}

// ---------------------------------------------------------------------------
// Agent workspace file builder (for workspace registry files)
// ---------------------------------------------------------------------------

/** Build an agent markdown file with identity-style content. */
function buildAgentWorkspaceFile(agent: AgentData): string {
  const lines: string[] = [];

  // YAML frontmatter
  lines.push('---');
  lines.push(`id: ${agent.id}`);
  lines.push(`name: ${agent.name}`);
  lines.push(`role: ${agent.role}`);
  lines.push(`status: ${agent.status}`);
  lines.push(`icon: ${agent.icon}`);
  if (agent.tagline) lines.push(`tagline: "${agent.tagline.replace(/"/g, '\\"')}"`);
  lines.push(`createdAt: ${new Date().toISOString()}`);
  lines.push('---');
  lines.push('');

  // Identity section
  lines.push(`# ${agent.name}`);
  lines.push('');
  if (agent.tagline) {
    lines.push(`> ${agent.tagline}`);
    lines.push('');
  }
  if (agent.description) {
    lines.push(agent.description);
    lines.push('');
  }

  // Role
  lines.push('## Role');
  lines.push('');
  lines.push(`- **Role**: ${agent.roleLabel || agent.role}`);
  lines.push(`- **Status**: ${agent.status}`);
  lines.push('');

  // Skills (if any)
  if (agent.skills && agent.skills.length > 0) {
    lines.push('## Skills');
    lines.push('');
    for (const skill of agent.skills) {
      const status = skill.enabled ? 'enabled' : 'disabled';
      const cost = skill.tokenCostHint ? ` ${skill.tokenCostHint}` : '';
      lines.push(`- **${skill.name}** (${skill.category}) - ${skill.description} [${status}]${cost}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
