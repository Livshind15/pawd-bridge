import { FastifyInstance } from 'fastify';
import * as integrationStore from '../../store/entities/integrations.js';

export function integrationRoutes(fastify: FastifyInstance): void {
  // GET /api/integrations
  fastify.get('/api/integrations', async () => {
    const integrations = integrationStore.getIntegrations();
    return { integrations };
  });
}
