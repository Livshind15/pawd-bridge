import type { FastifyInstance } from 'fastify';
import { hookManager } from '../../hooks/hook-manager.js';
import { discoverHooks, readHooksConfig } from '../../hooks/hook-discovery.js';

export function hookRoutes(fastify: FastifyInstance): void {
  // GET /api/hooks/active — List all currently active hooks
  fastify.get('/api/hooks/active', async () => {
    const hooks = hookManager.getActiveHooks();
    return { hooks, count: hooks.length };
  });

  // GET /api/hooks/history — List hook history (supports ?limit=N)
  fastify.get<{ Querystring: { limit?: string } }>('/api/hooks/history', async (request) => {
    const limitParam = request.query.limit;
    const limit = limitParam ? parseInt(limitParam, 10) : undefined;
    const hooks = hookManager.getHookHistory(limit && !isNaN(limit) ? limit : undefined);
    return { hooks, count: hooks.length };
  });

  // GET /api/hooks/config — Get hook configuration from filesystem
  fastify.get('/api/hooks/config', async () => {
    return readHooksConfig();
  });

  // GET /api/hooks/list — List all hook definitions from filesystem
  fastify.get('/api/hooks/list', async () => {
    const hooks = discoverHooks();
    return { hooks, count: hooks.length };
  });

  // GET /api/hooks/list/eligible — List only eligible hook definitions
  fastify.get('/api/hooks/list/eligible', async () => {
    const hooks = discoverHooks();
    return { hooks, count: hooks.length };
  });

  // GET /api/hooks/check — Check hook eligibility
  fastify.get('/api/hooks/check', async () => {
    return { unsupported: true, message: 'Hook eligibility checks are managed locally' };
  });

  // POST /api/hooks/:hookId/enable — Enable a specific hook (local management)
  fastify.post<{ Params: { hookId: string } }>('/api/hooks/:hookId/enable', async (request, reply) => {
    const { hookId } = request.params;
    reply.code(501);
    return { error: 'Hook enable/disable is not yet supported in SDK mode', hookId };
  });

  // POST /api/hooks/:hookId/disable — Disable a specific hook (local management)
  fastify.post<{ Params: { hookId: string } }>('/api/hooks/:hookId/disable', async (request, reply) => {
    const { hookId } = request.params;
    reply.code(501);
    return { error: 'Hook enable/disable is not yet supported in SDK mode', hookId };
  });

  // GET /api/hooks/:hookId/info — Get detailed hook information
  fastify.get<{ Params: { hookId: string } }>('/api/hooks/:hookId/info', async (request) => {
    const { hookId } = request.params;
    const hook = hookManager.getHookById(hookId);
    if (hook) return hook;
    return { hookId, info: 'Hook info not available' };
  });

  // GET /api/hooks/:hookId — Get a specific hook by ID
  fastify.get<{ Params: { hookId: string } }>('/api/hooks/:hookId', async (request, reply) => {
    const { hookId } = request.params;
    const hook = hookManager.getHookById(hookId);
    if (!hook) {
      reply.code(404);
      return { error: 'Hook not found', hookId };
    }
    return hook;
  });
}
