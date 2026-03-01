import type { FastifyInstance } from 'fastify';

export function deviceRoutes(fastify: FastifyInstance): void {
  // POST /api/devices/token/rotate — Rotate a device token
  // Device token management is now handled locally via the pair routes
  fastify.post('/api/devices/token/rotate', async (_request, reply) => {
    return reply.status(501).send({ error: 'Device token rotation is managed via /api/devices/pair' });
  });

  // POST /api/devices/token/revoke — Revoke a device token
  // Device token management is now handled locally via the pair routes
  fastify.post('/api/devices/token/revoke', async (_request, reply) => {
    return reply.status(501).send({ error: 'Device token revocation is managed via DELETE /api/devices/:deviceId' });
  });
}
