import type { FastifyInstance } from 'fastify';
import { activityFeedStore } from '../../store/entities/activity-feed.js';

export function activityRoutes(fastify: FastifyInstance): void {
  // GET /api/activity/feed — Paginated activity feed
  fastify.get<{
    Querystring: { limit?: string; offset?: string; type?: string };
  }>('/api/activity/feed', async (request) => {
    const limit = Math.min(parseInt(request.query.limit || '50', 10) || 50, 200);
    const offset = parseInt(request.query.offset || '0', 10) || 0;
    const type = request.query.type || undefined;

    const events = activityFeedStore.getEvents(limit, offset, type);
    const total = activityFeedStore.getTotal(type);

    return {
      events,
      total,
      hasMore: offset + events.length < total,
    };
  });

  // GET /api/activity/feed/types — List all event types seen
  fastify.get('/api/activity/feed/types', async () => {
    const types = activityFeedStore.getEventTypes();
    return { types };
  });
}
