/**
 * Agent Config Builder — constructs full SDK query() options per-agent.
 *
 * Reads workspace identity files, builds the system prompt, configures tools,
 * MCP servers, and hooks. The returned AgentConfig is consumed by agent-runner
 * to invoke the SDK's query() function.
 */

import type {
  AgentDefinition,
  HookCallback,
  PreCompactHookInput,
  PreToolUseHookInput,
} from '@anthropic-ai/claude-agent-sdk';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import type { AgentConfig } from './types.js';
import {
  agentWorkspacePath,
  ensureAgentWorkspace,
  buildSystemPromptAppend,
  readIdentityFile,
} from './workspace.js';
import { getAgentById } from '../store/entities/agents.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default set of tools every agent gets. */
const DEFAULT_TOOLS: string[] = [
  'Bash',
  'Read',
  'Write',
  'Edit',
  'Glob',
  'Grep',
  'WebSearch',
  'WebFetch',
  'Task',
  'TaskOutput',
  'Skill',
  'NotebookEdit',
];

/** Environment variables that must never leak into Bash subprocesses. */
const SECRET_ENV_VARS = ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN'];

// ---------------------------------------------------------------------------
// Hook factories
// ---------------------------------------------------------------------------

/**
 * PreCompact hook: archive the full transcript before the SDK compacts it.
 * Writes a timestamped markdown file to the agent's workspace/conversations/ dir.
 */
function createPreCompactHook(agentId: string): HookCallback {
  return async (input, _toolUseId, _context) => {
    const preCompact = input as PreCompactHookInput;
    const transcriptPath = (preCompact as unknown as { transcript_path?: string }).transcript_path;

    if (!transcriptPath || !existsSync(transcriptPath)) {
      logger.debug({ agentId }, 'PreCompact: no transcript to archive');
      return {};
    }

    try {
      const wsDir = agentWorkspacePath(agentId);
      const conversationsDir = join(wsDir, 'conversations');
      mkdirSync(conversationsDir, { recursive: true });

      const content = readFileSync(transcriptPath, 'utf-8');
      const date = new Date().toISOString().split('T')[0];
      const time = new Date();
      const timeSuffix = `${time.getHours().toString().padStart(2, '0')}${time.getMinutes().toString().padStart(2, '0')}`;
      const filename = `${date}-conversation-${timeSuffix}.md`;
      const filePath = join(conversationsDir, filename);

      writeFileSync(filePath, content, 'utf-8');
      logger.debug({ agentId, path: filePath }, 'PreCompact: archived transcript');
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), agentId },
        'PreCompact: failed to archive transcript',
      );
    }

    return {};
  };
}

/**
 * PreToolUse hook for Bash: strips secret environment variables from commands.
 * Prevents API keys from leaking into shell subprocesses.
 */
function createSanitizeBashHook(): HookCallback {
  return async (input, _toolUseId, _context) => {
    const preInput = input as PreToolUseHookInput;
    const command = (preInput.tool_input as { command?: string })?.command;
    if (!command) return {};

    const unsetPrefix = `unset ${SECRET_ENV_VARS.join(' ')} 2>/dev/null; `;

    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse' as const,
        updatedInput: {
          ...(preInput.tool_input as Record<string, unknown>),
          command: unsetPrefix + command,
        },
      },
    };
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build the full AgentConfig for a given agent ID.
 *
 * Reads the agent's data from the bridge store, ensures the workspace exists,
 * assembles the system prompt from identity files, and wires up hooks.
 */
export function loadAgentConfig(agentId: string): AgentConfig {
  // Look up the agent in the bridge store
  const agent = getAgentById(agentId);
  const agentName = agent?.name ?? agentId;

  // Ensure the workspace directory structure exists
  const wsDir = ensureAgentWorkspace(agentId);

  // Build system prompt with identity context appended
  const append = buildSystemPromptAppend(agentId);
  const systemPrompt: AgentConfig['systemPrompt'] = append
    ? { type: 'preset', preset: 'claude_code', append }
    : { type: 'preset', preset: 'claude_code' };

  // Resolve model — agent-level override > environment default
  const model = agent?.model || process.env.PAWD_SDK_MODEL || undefined;

  // Build subagents with soul so Task tool spawns inherit identity
  const soulContent = readIdentityFile(agentId, 'SOUL.md');
  const identityContent = readIdentityFile(agentId, 'IDENTITY.md');
  const subagentPrompt = [soulContent, identityContent].filter(Boolean).join('\n\n');

  const subagents: Record<string, AgentDefinition> = {};
  if (subagentPrompt.trim()) {
    subagents['general-purpose'] = {
      description: 'A general-purpose subagent that inherits the parent agent\'s soul and identity.',
      prompt: subagentPrompt,
      model: 'inherit',
    };
  }

  // Build environment variables for the SDK child process.
  // Explicitly set both credential vars so the SDK can authenticate.
  // CLAUDE_CODE_OAUTH_TOKEN (subscription) takes priority over ANTHROPIC_API_KEY.
  const env: Record<string, string | undefined> = {
    ...process.env,
    CLAUDE_AGENT_SDK_CLIENT_APP: `pawd-bridge/1.0.0`,
  };

  // Ensure credentials are present in env even if loaded from .env file
  if (config.claudeOAuthToken) {
    env.CLAUDE_CODE_OAUTH_TOKEN = config.claudeOAuthToken;
  }
  if (config.anthropicApiKey) {
    env.ANTHROPIC_API_KEY = config.anthropicApiKey;
  }

  logger.debug({ agentId, agentName, model, hasCwd: !!wsDir }, 'Built agent config');

  return {
    id: agentId,
    name: agentName,
    systemPrompt,
    allowedTools: [...DEFAULT_TOOLS],
    mcpServers: {},
    hooks: {
      PreCompact: [{ hooks: [createPreCompactHook(agentId)] }],
      PreToolUse: [{ matcher: 'Bash', hooks: [createSanitizeBashHook()] }],
    },
    subagents,
    cwd: wsDir,
    settingSources: ['project', 'user'],
    model,
    env,
  };
}
