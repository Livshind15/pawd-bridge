import type { FastifyInstance } from 'fastify';
import { hookManager } from '../../hooks/hook-manager.js';
import { eventBus } from '../../events/bus.js';
import { activityFeedStore } from '../../store/entities/activity-feed.js';
import { generateId } from '../../utils/id.js';
import { logger } from '../../utils/logger.js';

interface IngestBody {
  hookName: string;
  eventType: string;
  eventAction: string;
  sessionKey?: string;
  timestamp: string;
  context?: Record<string, unknown>;
}

export function hookIngestRoutes(fastify: FastifyInstance): void {
  // POST /api/hooks/ingest — Receive events from SDK hooks
  fastify.post<{ Body: IngestBody }>('/api/hooks/ingest', async (request, reply) => {
    const { hookName, eventType, eventAction, sessionKey, timestamp, context } = request.body;

    // Validate required fields
    if (!hookName || !eventType || !eventAction || !timestamp) {
      reply.code(400);
      return {
        error: 'Missing required fields: hookName, eventType, eventAction, timestamp',
      };
    }

    const hookId = generateId('hki');

    // Register the hook in the manager
    hookManager.registerHook(hookId, {
      name: hookName,
      eventType,
      eventAction,
      sessionKey,
    });

    // Broadcast to any SSE/WebSocket listeners
    eventBus.broadcast({
      type: 'hook.ingest',
      payload: {
        hookId,
        hookName,
        eventType,
        eventAction,
        sessionKey,
        timestamp,
        context: context ?? {},
      },
    });

    // Ingest events are instantaneous — auto-resolve immediately
    hookManager.resolveHook(hookId, {
      eventType,
      eventAction,
      receivedAt: new Date().toISOString(),
    });

    // Track in activity feed so hooks appear in the unified timeline
    activityFeedStore.addEvent({
      type: 'hook.triggered',
      source: 'hook',
      title: `Hook: ${hookName}`,
      hookId,
      status: 'completed',
      description: `${eventType}.${eventAction}`,
      metadata: { hookName, eventType, eventAction, sessionKey },
    });

    logger.info(
      { hookId, hookName, eventType, eventAction },
      '[hook-ingest] Event ingested',
    );

    return { success: true, hookId };
  });
}
