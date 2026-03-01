import type { FastifyInstance } from 'fastify';
import { listSessions, deleteSession, getSession } from '../../sdk/index.js';
import { logger } from '../../utils/logger.js';
import type { SessionInfo } from '../../sdk/types.js';

/** Transform internal SessionInfo into the GatewaySession shape the mobile app expects. */
function toGatewaySession(s: SessionInfo) {
  return {
    key: `${s.agentId}::${s.conversationId}`,
    agentId: s.agentId,
    status: 'idle',
    model: 'claude-sonnet-4-20250514',
    messageCount: s.messageCount,
    createdAt: s.createdAt,
    lastActivityAt: s.lastActiveAt,
  };
}

export function sessionRoutes(fastify: FastifyInstance): void {
  // GET /api/sessions — List all SDK sessions
  fastify.get('/api/sessions', async () => {
    const sessions = listSessions().map(toGatewaySession);
    return { sessions, count: sessions.length };
  });

  // GET /api/sessions/:key/preview — Preview a session
  fastify.get<{ Params: { key: string } }>('/api/sessions/:key/preview', async (request) => {
    const { key } = request.params;
    // Parse key format: "agentId::conversationId"
    const parts = key.split('::');
    if (parts.length === 2) {
      const session = getSession(parts[0], parts[1]);
      if (session) return { session: toGatewaySession(session) };
    }
    // Try to find session by sessionId
    const all = listSessions();
    const found = all.find((s) => s.sessionId === key);
    return found ? { session: toGatewaySession(found) } : { session: null };
  });

  // GET /api/sessions/:key/status — Get session status
  fastify.get<{ Params: { key: string } }>('/api/sessions/:key/status', async (request) => {
    const { key } = request.params;
    const parts = key.split('::');
    if (parts.length === 2) {
      const session = getSession(parts[0], parts[1]);
      if (session) return { key, status: 'idle', session: toGatewaySession(session) };
    }
    const all = listSessions();
    const found = all.find((s) => s.sessionId === key);
    return { key, status: found ? 'idle' : 'unknown', session: found ? toGatewaySession(found) : null };
  });

  // POST /api/sessions/:key/compact — Compact a session (SDK handles compaction automatically)
  fastify.post<{ Params: { key: string } }>('/api/sessions/:key/compact', async (request) => {
    const { key } = request.params;
    logger.info({ key }, 'Session compact requested — SDK handles compaction automatically');
    return { success: true, key, message: 'SDK handles session compaction automatically' };
  });

  // POST /api/sessions/:key/model — Set session model (no longer applicable with SDK)
  fastify.post<{ Params: { key: string }; Body: { model: string } }>(
    '/api/sessions/:key/model',
    async (request) => {
      const { key } = request.params;
      const body = request.body as { model: string };
      logger.info({ key, model: body.model }, 'Session model change requested — configure via agent settings');
      return { success: true, key, model: body.model, message: 'Model is configured per-agent, not per-session' };
    }
  );

  // POST /api/sessions/:key/resolve — Resolve a session prompt/action (not applicable with SDK)
  fastify.post<{ Params: { key: string } }>(
    '/api/sessions/:key/resolve',
    async (_request, reply) => {
      return reply.status(501).send({ error: 'Session resolve is not supported in SDK mode' });
    }
  );

  // DELETE /api/sessions/:key — Delete a session
  fastify.delete<{ Params: { key: string } }>('/api/sessions/:key', async (request) => {
    const { key } = request.params;
    // Parse key format: "agentId::conversationId"
    const parts = key.split('::');
    if (parts.length === 2) {
      const deleted = deleteSession(parts[0], parts[1]);
      return { success: deleted, key };
    }
    // Try by sessionId — find and delete
    const all = listSessions();
    const found = all.find((s) => s.sessionId === key);
    if (found) {
      const deleted = deleteSession(found.agentId, found.conversationId);
      return { success: deleted, key };
    }
    return { success: false, key, error: 'Session not found' };
  });
}
