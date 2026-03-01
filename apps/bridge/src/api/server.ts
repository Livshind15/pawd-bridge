import { join } from 'path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import staticPlugin from '@fastify/static';
import { config } from '../config.js';
import { authMiddleware } from './middleware/auth.js';
import { errorHandler } from './middleware/errors.js';
import { agentRoutes } from './routes/agents.js';
import { taskRoutes } from './routes/tasks.js';
import { chatRoutes } from './routes/chat.js';
import { terminalRoutes } from './routes/terminal.js';
import { eventRoutes } from './routes/events.js';
import { tokenRoutes } from './routes/tokens.js';
import { statusRoutes } from './routes/status.js';
import { integrationRoutes } from './routes/integrations.js';
import { integrationConfigRoutes } from './routes/integration-config.js';
import { metricsRoutes } from './routes/metrics.js';
import { uploadRoutes } from './routes/uploads.js';
import { skillsRoutes } from './routes/skills.js';

import { cronRoutes } from './routes/cron.js';
import { apiKeyRoutes } from './routes/api-keys.js';
import { transcribeRoutes } from './routes/transcribe.js';
import { skillRegistryRoutes } from './routes/skill-registry.js';
import { hookRoutes } from './routes/hooks.js';
import { hookIngestRoutes } from './routes/hook-ingest.js';
import { sessionRoutes } from './routes/sessions.js';
import { nodeRoutes } from './routes/nodes.js';
import { deviceRoutes } from './routes/devices.js';
import { pairRoutes } from './routes/pair.js';
import { filesystemRoutes } from './routes/filesystem.js';
import { webhookRoutes } from './routes/webhooks.js';
import { activityRoutes } from './routes/activity.js';

export async function createServer() {
  const fastify = Fastify({
    logger: false, // We use our own pino logger
  });

  // Override default JSON parser to accept empty bodies (treat as {}).
  // Some callers (e.g. lifecycle provision) POST with Content-Type:
  // application/json but no body — Fastify's default parser rejects that.
  fastify.removeContentTypeParser('application/json');
  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_req: { headers: Record<string, unknown> }, body: string, done: (err: Error | null, result?: unknown) => void) => {
      const str = (body || '').trim();
      if (!str) { done(null, {}); return; }
      try { done(null, JSON.parse(str)); }
      catch (err) { done(err as Error); }
    },
  );

  // CORS
  await fastify.register(cors, {
    origin: true,
    credentials: true,
  });

  // Rate limiting — opt-in per route (global: false keeps all existing routes untouched)
  await fastify.register(rateLimit, { global: false });

  // Multipart file upload support (25MB limit — needed for audio transcription)
  await fastify.register(multipart, {
    limits: { fileSize: 25 * 1024 * 1024 },
  });

  // Static file serving for uploaded assets (avatars, etc.)
  await fastify.register(staticPlugin, {
    root: join(config.dataDir, 'uploads'),
    prefix: '/api/uploads/',
    decorateReply: false,
  });

  // Error handler
  fastify.setErrorHandler(errorHandler);

  // Auth middleware for all /api routes except status and events
  fastify.addHook('onRequest', async (request, reply) => {
    // Skip auth for health check and SSE (SSE validates via query param if needed)
    const publicPaths = ['/api/status', '/api/events', '/api/uploads/', '/health', '/pair', '/api/devices/pair', '/api/devices/pair-info', '/api/hooks/ingest', '/api/webhooks/trigger/'];
    if (publicPaths.some((p) => request.url.startsWith(p))) {
      return;
    }
    if (request.url.startsWith('/api/')) {
      await authMiddleware(request, reply);
    }
  });

  // Register routes — all route functions now take only (fastify)
  agentRoutes(fastify);
  taskRoutes(fastify);
  chatRoutes(fastify);
  terminalRoutes(fastify);
  eventRoutes(fastify);
  tokenRoutes(fastify);
  statusRoutes(fastify);
  integrationRoutes(fastify);
  integrationConfigRoutes(fastify);
  metricsRoutes(fastify);
  uploadRoutes(fastify);
  skillsRoutes(fastify);

  cronRoutes(fastify);
  apiKeyRoutes(fastify);
  transcribeRoutes(fastify);
  skillRegistryRoutes(fastify);
  hookRoutes(fastify);
  hookIngestRoutes(fastify);
  sessionRoutes(fastify);
  nodeRoutes(fastify);
  deviceRoutes(fastify);
  pairRoutes(fastify);
  filesystemRoutes(fastify);
  webhookRoutes(fastify);
  activityRoutes(fastify);

  return fastify;
}
