/**
 * Agent Runner — core wrapper around the SDK's query() function.
 *
 * Provides runAgent() (fire-and-forget async) and abortAgent() (cancel via
 * AbortController). Translates SDK messages into bridge StreamEvents and
 * broadcasts them via the bridge EventBus.
 *
 * Follows the NanoClaw pattern:
 *   1. Load agent config
 *   2. Get or create session (resume if exists)
 *   3. Create MessageStream, push user message
 *   4. Call query() with full options
 *   5. For each SDK message, translate and broadcast
 *   6. Persist session on completion
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import type {
  SDKMessage,
  SDKSystemMessage,
  SDKAssistantMessage,
  SDKResultMessage,
  SDKToolUseSummaryMessage,
  SDKToolProgressMessage,
  SDKPartialAssistantMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { execSync } from 'child_process';
import { logger } from '../utils/logger.js';
import { eventBus } from '../events/bus.js';
import { loadAgentConfig } from './agent-config.js';
import { MessageStream, type MessageAttachment } from './message-stream.js';
import { getSession, saveSession } from './session-store.js';
import type {
  StreamEvent,
  SessionInfo,
  AgentConfig,
} from './types.js';

// ---------------------------------------------------------------------------
// Preflight check — run once at import time
// ---------------------------------------------------------------------------

(function checkClaudeCli() {
  try {
    const version = execSync('claude --version', { encoding: 'utf-8', stdio: 'pipe' }).trim();
    logger.info({ version }, 'Claude Code CLI found');
  } catch {
    logger.warn(
      'Claude Code CLI not found! The SDK requires "claude" to be installed. ' +
      'Run: npm install -g @anthropic-ai/claude-code@latest',
    );
  }
})();

// ---------------------------------------------------------------------------
// Active run tracking (for abort support)
// ---------------------------------------------------------------------------

interface ActiveRun {
  abortController: AbortController;
  stream: MessageStream;
  agentId: string;
  conversationId: string;
  startedAt: number;
}

/** Map of "agentId::conversationId" -> active run metadata. */
const activeRuns = new Map<string, ActiveRun>();

function runKey(agentId: string, conversationId: string): string {
  return `${agentId}::${conversationId}`;
}

// ---------------------------------------------------------------------------
// Event helpers
// ---------------------------------------------------------------------------

function now(): string {
  return new Date().toISOString();
}

function broadcast(event: StreamEvent): void {
  eventBus.broadcast({
    type: event.type,
    payload: event as unknown as Record<string, unknown>,
  });
}

// ---------------------------------------------------------------------------
// SDK message -> StreamEvent translation
// ---------------------------------------------------------------------------

function translateMessage(
  message: SDKMessage,
  agentId: string,
  conversationId: string,
): StreamEvent | StreamEvent[] | null {
  const base = { agentId, conversationId, timestamp: now() };

  switch (message.type) {
    case 'system': {
      if (message.subtype === 'init') {
        const init = message as SDKSystemMessage;
        return {
          ...base,
          type: 'session.init',
          sessionId: init.session_id,
          model: init.model,
          tools: init.tools,
        };
      }
      // Other system subtypes (compact_boundary, etc.) — skip
      return null;
    }

    case 'assistant': {
      const assistant = message as SDKAssistantMessage;
      // Extract text content blocks and tool_use blocks
      const contentBlocks = assistant.message?.content ?? [];

      const events: StreamEvent[] = [];

      // Emit the full assistant message event
      events.push({
        ...base,
        type: 'agent.message',
        uuid: assistant.uuid,
        sessionId: assistant.session_id,
        content: contentBlocks as unknown[],
      });

      // Also emit tool.started for any tool_use blocks in the message
      for (const block of contentBlocks) {
        const b = block as { type: string; id?: string; name?: string; input?: unknown };
        if (b.type === 'tool_use' && b.id && b.name) {
          events.push({
            ...base,
            type: 'tool.started',
            toolName: b.name,
            toolUseId: b.id,
            input: b.input ?? {},
          });
        }
      }

      return events;
    }

    case 'result': {
      const result = message as SDKResultMessage;
      const isSuccess = result.subtype === 'success';
      return {
        ...base,
        type: 'agent.result',
        subtype: result.subtype,
        result: isSuccess && 'result' in result ? (result as { result: string }).result : null,
        isError: result.is_error,
        durationMs: result.duration_ms,
        totalCostUsd: result.total_cost_usd,
        usage: {
          inputTokens: result.usage.input_tokens,
          outputTokens: result.usage.output_tokens,
          cacheReadInputTokens: result.usage.cache_read_input_tokens,
          cacheCreationInputTokens: result.usage.cache_creation_input_tokens,
        },
      };
    }

    case 'tool_use_summary': {
      const summary = message as SDKToolUseSummaryMessage;
      // Emit as tool.completed for each preceding tool use
      const events: StreamEvent[] = [];
      for (const toolUseId of summary.preceding_tool_use_ids) {
        events.push({
          ...base,
          type: 'tool.completed',
          toolName: 'unknown',
          toolUseId,
          output: summary.summary,
        });
      }
      return events.length > 0 ? events : null;
    }

    case 'stream_event': {
      const partial = message as SDKPartialAssistantMessage;
      const event = partial.event;
      // Extract text delta from content_block_delta events
      if (
        event.type === 'content_block_delta' &&
        'delta' in event &&
        (event.delta as { type: string }).type === 'text_delta'
      ) {
        const text = (event.delta as { text?: string }).text ?? '';
        if (text) {
          return {
            ...base,
            type: 'agent.stream.delta',
            text,
            parentToolUseId: partial.parent_tool_use_id,
          };
        }
      }
      return null;
    }

    default:
      // tool_progress, auth_status, task_notification, etc. — handle selectively
      if ('type' in message && (message as { type: string }).type === 'tool_progress') {
        const tp = message as unknown as SDKToolProgressMessage;
        return {
          ...base,
          type: 'tool.progress',
          toolName: tp.tool_name ?? 'unknown',
          toolUseId: tp.tool_use_id ?? '',
          progress: `Running for ${tp.elapsed_time_seconds}s`,
        };
      }
      return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run the agent for a single query. Fire-and-forget — broadcasts events
 * via the bridge EventBus as the SDK produces messages.
 *
 * @param agentId      Agent to run.
 * @param conversationId  Bridge conversation ID.
 * @param message      User message text.
 * @param attachments  Optional file attachments.
 */
export async function runAgent(
  agentId: string,
  conversationId: string,
  message: string,
  attachments?: MessageAttachment[],
): Promise<void> {
  const key = runKey(agentId, conversationId);

  // Prevent concurrent runs for the same agent+conversation
  if (activeRuns.has(key)) {
    logger.warn({ agentId, conversationId }, 'Agent already running, ignoring duplicate');
    return;
  }

  const abortController = new AbortController();
  const stream = new MessageStream();
  const stderrChunks: string[] = [];

  const run: ActiveRun = {
    abortController,
    stream,
    agentId,
    conversationId,
    startedAt: Date.now(),
  };
  activeRuns.set(key, run);

  try {
    // 1. Load agent config
    const agentConfig: AgentConfig = loadAgentConfig(agentId);

    // 2. Get or create session (for resume)
    const existingSession = getSession(agentId, conversationId);
    const resumeSessionId = existingSession?.sessionId;
    const resumeAt = existingSession?.lastAssistantUuid ?? undefined;

    // 3. Push user message into the stream, then end it (single-turn-per-call)
    stream.push(message, attachments);
    stream.end();

    logger.info(
      {
        agentId,
        conversationId,
        resumeSessionId: resumeSessionId ?? 'new',
        resumeAt: resumeAt ?? 'latest',
        messageLength: message.length,
        cwd: agentConfig.cwd,
        model: agentConfig.model ?? 'default',
        hasOAuthToken: !!agentConfig.env.CLAUDE_CODE_OAUTH_TOKEN,
        hasApiKey: !!agentConfig.env.ANTHROPIC_API_KEY,
        toolCount: agentConfig.allowedTools.length,
      },
      'Starting SDK query',
    );

    // 4. Call query()
    let newSessionId: string | undefined;
    let lastAssistantUuid: string | undefined;
    let messageCount = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    for await (const sdkMessage of query({
      prompt: stream,
      options: {
        abortController,
        cwd: agentConfig.cwd,
        systemPrompt: agentConfig.systemPrompt,
        allowedTools: agentConfig.allowedTools,
        mcpServers: agentConfig.mcpServers,
        hooks: agentConfig.hooks,
        agents: agentConfig.subagents,
        model: agentConfig.model,
        env: agentConfig.env,
        settingSources: agentConfig.settingSources,
        resume: resumeSessionId,
        resumeSessionAt: resumeAt,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        includePartialMessages: true,
        debug: true,
        stderr: (data: string) => {
          stderrChunks.push(data);
          logger.debug({ agentId, conversationId, stderr: data.trim() }, 'SDK stderr');
        },
      },
    })) {
      messageCount++;

      // Track session ID from init message
      if (sdkMessage.type === 'system' && sdkMessage.subtype === 'init') {
        newSessionId = sdkMessage.session_id;
      }

      // Track last assistant UUID for resume
      if (sdkMessage.type === 'assistant' && 'uuid' in sdkMessage) {
        lastAssistantUuid = sdkMessage.uuid;
      }

      // Track token usage from result
      if (sdkMessage.type === 'result') {
        totalInputTokens += sdkMessage.usage.input_tokens;
        totalOutputTokens += sdkMessage.usage.output_tokens;
      }

      // 5. Translate and broadcast
      const events = translateMessage(sdkMessage, agentId, conversationId);
      if (events) {
        if (Array.isArray(events)) {
          for (const evt of events) broadcast(evt);
        } else {
          broadcast(events);
        }
      }
    }

    // 6. Persist session
    const sessionId = newSessionId ?? resumeSessionId;
    if (sessionId) {
      const sessionInfo: SessionInfo = {
        sessionId,
        lastAssistantUuid: lastAssistantUuid ?? existingSession?.lastAssistantUuid ?? null,
        agentId,
        conversationId,
        createdAt: existingSession?.createdAt ?? now(),
        lastActiveAt: now(),
        messageCount: (existingSession?.messageCount ?? 0) + 1,
        totalTokens:
          (existingSession?.totalTokens ?? 0) + totalInputTokens + totalOutputTokens,
      };
      saveSession(sessionInfo);
      logger.debug({ agentId, conversationId, sessionId, messageCount }, 'Session persisted');
    }

    logger.info(
      {
        agentId,
        conversationId,
        messageCount,
        durationMs: Date.now() - run.startedAt,
      },
      'SDK query completed',
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    let collectedStderr = '(unavailable)';
    try { collectedStderr = stderrChunks.join('').trim() || '(empty)'; } catch { /* ignore */ }

    logger.error(
      {
        err: errorMessage,
        agentId,
        conversationId,
        processStderr: collectedStderr,
        stack: err instanceof Error ? err.stack?.split('\n').slice(0, 5).join('\n') : undefined,
      },
      'SDK query failed',
    );

    broadcast({
      agentId,
      conversationId,
      timestamp: now(),
      type: 'agent.error',
      error: errorMessage,
    });
  } finally {
    activeRuns.delete(key);
  }
}

/**
 * Abort a running agent query. The SDK will clean up resources and the
 * run loop will exit gracefully.
 *
 * @returns true if an active run was found and aborted.
 */
export function abortAgent(agentId: string, conversationId: string): boolean {
  const key = runKey(agentId, conversationId);
  const run = activeRuns.get(key);
  if (!run) return false;

  logger.info({ agentId, conversationId }, 'Aborting SDK query');
  run.abortController.abort();

  // Also end the message stream in case it is still open
  if (!run.stream.ended) {
    run.stream.end();
  }

  broadcast({
    agentId,
    conversationId,
    timestamp: now(),
    type: 'agent.aborted',
  });

  activeRuns.delete(key);
  return true;
}

/**
 * Check if an agent is currently running a query.
 */
export function isAgentRunning(agentId: string, conversationId: string): boolean {
  return activeRuns.has(runKey(agentId, conversationId));
}

/**
 * Get metadata about all currently active runs.
 */
export function listActiveRuns(): Array<{
  agentId: string;
  conversationId: string;
  startedAt: number;
  durationMs: number;
}> {
  const nowMs = Date.now();
  return Array.from(activeRuns.values()).map((run) => ({
    agentId: run.agentId,
    conversationId: run.conversationId,
    startedAt: run.startedAt,
    durationMs: nowMs - run.startedAt,
  }));
}
