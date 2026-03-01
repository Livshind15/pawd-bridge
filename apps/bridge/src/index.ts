import { config } from './config.js';
import { logger } from './utils/logger.js';
import { createServer } from './api/server.js';
import { initDataDir } from './seed.js';
import * as conversationStore from './store/entities/conversations.js';
import * as agentStore from './store/entities/agents.js';
import { parseResponse } from './sdk/response-parser.js';
import { generateId } from './utils/id.js';
import { eventBus } from './events/bus.js';
import { syncTaskStates, initTaskSnapshots } from './tasks/sync.js';
import { ensureAgentWorkspace } from './sdk/workspace.js';
import { startScheduler, stopScheduler, ensureDefaultHeartbeats } from './cron/scheduler.js';

async function main() {
  // Ensure data directory exists with seed data
  await initDataDir();

  // Ensure all agent SDK workspaces exist — creates directory structure,
  // .claude/settings.json, and default CLAUDE.md if missing.
  const allAgents = agentStore.getAllAgents();
  for (const agent of allAgents) {
    ensureAgentWorkspace(agent.id);
  }
  logger.info({ count: allAgents.length }, 'Ensured agent SDK workspaces');

  // Initialize task state snapshots (so the first sync cycle only fires real changes)
  initTaskSnapshots();

  // Periodic task sync (60s interval)
  const SYNC_INTERVAL_MS = 60_000;
  const syncTimer = setInterval(() => {
    syncTaskStates();
    logger.debug('Periodic task sync completed');
  }, SYNC_INTERVAL_MS);

  // Persist assistant messages from SDK agent.result events.
  // When the agent finishes generating (agent.result with subtype='success'),
  // parse and store the message.
  eventBus.on('bridge-event', (event: { type: string; payload: Record<string, unknown> }) => {
    if (event.type !== 'agent.result') return;
    const payload = event.payload;
    const subtype = payload.subtype as string | undefined;
    logger.info({ subtype, payloadKeys: Object.keys(payload) }, '[index] agent.result event in persistence handler');
    if (subtype !== 'success') return;

    const conversationId = payload.conversationId as string | undefined;
    const agentId = payload.agentId as string | undefined;
    if (!conversationId) return;

    // Verify conversation exists before persisting
    const conv = conversationStore.getConversation(conversationId);
    if (!conv) {
      logger.warn({ conversationId }, '[index] Conversation not found for persistence');
      return;
    }

    try {
      // The result payload may contain content blocks from the SDK
      const resultData = payload.result as Record<string, unknown> | string | null;
      let messageData: Record<string, unknown>;

      if (resultData && typeof resultData === 'object') {
        messageData = resultData;
      } else if (typeof resultData === 'string') {
        messageData = { content: resultData };
      } else {
        // No result content to persist
        return;
      }

      const parsed = parseResponse(messageData);

      // Skip silent/internal replies
      const trimmed = parsed.content.trim();
      const silentReplies = ['NO_REPLY', 'HEARTBEAT_OK', 'REPLY_SKIP', 'ANNOUNCE_SKIP', '[no-reply]'];
      if (silentReplies.includes(trimmed)) return;

      const assistantMessage: conversationStore.ChatMessage = {
        id: generateId('msg'),
        role: 'assistant',
        content: parsed.content,
        contentParts: parsed.contentParts,
        timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
        toolCalls: parsed.toolCalls,
        reasoning: parsed.reasoning,
        metadata: parsed.metadata,
        agentId,
        agentName: agentId ? agentStore.getAgentById(agentId)?.name : undefined,
      };

      conversationStore.appendMessage(conversationId, assistantMessage);

      // Broadcast completion so mobile clients know to refresh
      eventBus.broadcast({
        type: 'message.complete',
        payload: {
          conversationId,
          agentId,
          message: assistantMessage as unknown as Record<string, unknown>,
        },
      });

      logger.info({ conversationId, msgId: assistantMessage.id }, 'Persisted assistant message from agent.result event');
    } catch (err) {
      logger.error({ err, conversationId }, 'Failed to persist assistant message from agent.result event');
    }
  });

  // Create and start HTTP server
  const server = await createServer();

  try {
    await server.listen({ port: config.port, host: '0.0.0.0' });
    logger.info({ port: config.port }, 'Pawd Bridge Server started');
    logger.info({ dataDir: config.dataDir }, 'Data directory');

    // Reconcile default heartbeat cron jobs for all agents
    ensureDefaultHeartbeats();

    // Start cron scheduler
    startScheduler();

    // Log SDK auth status
    const authMethod = config.claudeOAuthToken
      ? 'CLAUDE_CODE_OAUTH_TOKEN'
      : config.anthropicApiKey
        ? 'ANTHROPIC_API_KEY'
        : 'NONE';
    logger.info({ authMethod }, 'SDK authentication');
  } catch (err) {
    logger.error({ err }, 'Failed to start server');
    process.exit(1);
  }

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down...');
    stopScheduler();
    clearInterval(syncTimer);
    await server.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
