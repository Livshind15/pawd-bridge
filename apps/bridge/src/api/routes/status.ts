import { FastifyInstance } from 'fastify';
import * as agentStore from '../../store/entities/agents.js';
import * as taskStore from '../../store/entities/tasks.js';
import { loadLocalCronJobs } from '../../cron/cron-store.js';
import { config } from '../../config.js';
import { listActiveRuns } from '../../sdk/index.js';

export function statusRoutes(fastify: FastifyInstance): void {
  // GET /health — lightweight liveness probe (no auth required)
  fastify.get('/health', async () => {
    return { ok: true, uptime: process.uptime() };
  });

  // GET /api/status
  fastify.get('/api/status', async () => {
    const agents = agentStore.getAllAgents();
    const activeRuns = listActiveRuns();
    const allTasks = taskStore.getAllTasks();
    const cronJobs = loadLocalCronJobs();

    const status = {
      server: {
        uptime: process.uptime(),
        version: '1.0.0',
        port: process.env.PORT || 3001,
      },
      sdk: {
        ok: !!(config.claudeOAuthToken || config.anthropicApiKey),
        authMethod: config.claudeOAuthToken ? 'oauth_token' : config.anthropicApiKey ? 'api_key' : 'none',
        activeRuns: activeRuns.length,
      },
      agents: {
        total: agents.length,
        online: agents.filter((a) => a.status === 'online').length,
        busy: agents.filter((a) => a.status === 'busy').length,
        sleeping: agents.filter((a) => a.status === 'sleeping').length,
      },
      tasks: {
        total: allTasks.length,
        todo: allTasks.filter((t) => t.status === 'todo').length,
        in_progress: allTasks.filter((t) => t.status === 'in_progress').length,
        done: allTasks.filter((t) => t.status === 'done').length,
        blocked: allTasks.filter((t) => t.status === 'blocked').length,
      },
      cron: {
        total: cronJobs.length,
        enabled: cronJobs.filter((j) => j.enabled).length,
      },
    };

    return { status };
  });
}
