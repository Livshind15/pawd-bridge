import type { FastifyInstance } from 'fastify';

export function nodeRoutes(fastify: FastifyInstance): void {
  // POST /api/nodes/invoke — Invoke a node command (not available in SDK mode)
  fastify.post('/api/nodes/invoke', async (_request, reply) => {
    return reply.status(501).send({ error: 'Node invocation is not available in SDK mode' });
  });

  // GET /api/nodes/pairs — List all node pairs (not available in SDK mode)
  fastify.get('/api/nodes/pairs', async (_request, reply) => {
    return reply.status(501).send({ error: 'Node pairing is not available in SDK mode' });
  });

  // POST /api/nodes/pairs/request — Request a new node pair (not available in SDK mode)
  fastify.post('/api/nodes/pairs/request', async (_request, reply) => {
    return reply.status(501).send({ error: 'Node pairing is not available in SDK mode' });
  });

  // POST /api/nodes/pairs/:id/approve — Approve a node pair (not available in SDK mode)
  fastify.post<{ Params: { id: string } }>('/api/nodes/pairs/:id/approve', async (_request, reply) => {
    return reply.status(501).send({ error: 'Node pairing is not available in SDK mode' });
  });

  // POST /api/nodes/pairs/:id/reject — Reject a node pair (not available in SDK mode)
  fastify.post<{ Params: { id: string } }>('/api/nodes/pairs/:id/reject', async (_request, reply) => {
    return reply.status(501).send({ error: 'Node pairing is not available in SDK mode' });
  });

  // POST /api/nodes/pairs/:id/verify — Verify a node pair (not available in SDK mode)
  fastify.post<{ Params: { id: string } }>('/api/nodes/pairs/:id/verify', async (_request, reply) => {
    return reply.status(501).send({ error: 'Node pairing is not available in SDK mode' });
  });
}
