import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { FastifyInstance } from 'fastify';
import { config } from '../../config.js';
import * as agentStore from '../../store/entities/agents.js';
import { ensureAgentWorkspace, updateAgentHeartbeat, ensureHeartbeatConfig } from '../../store/workspace.js';
import { agentWorkspacePath } from '../../sdk/index.js';
import { logger } from '../../utils/logger.js';
import { generateId } from '../../utils/id.js';
import { CronJob, loadLocalCronJobs, saveLocalCronJobs, loadCronRuns } from '../../cron/cron-store.js';
import { runJobNow } from '../../cron/scheduler.js';

export interface CronJobInfo {
  agentId: string;
  agentName: string;
  enabled: boolean;
  hasHeartbeat: boolean;
  heartbeatPreview: string;
  workspacePath: string;
  lastActive: string;
  status: string;
}

export interface CronConfig {
  enabled: boolean;
  intervalSeconds: number;
}

function cronConfigPath(): string {
  return join(dirname(config.agentWorkspacesDir), 'cron-config.json');
}

function loadCronConfig(): CronConfig {
  try {
    const configPath = cronConfigPath();
    if (!existsSync(configPath)) return { enabled: false, intervalSeconds: 60 };
    const raw = readFileSync(configPath, 'utf-8');
    const ocConfig = JSON.parse(raw) as Record<string, unknown>;
    const cron = ocConfig.cron as Record<string, unknown> | undefined;
    return {
      enabled: cron?.enabled === true,
      intervalSeconds: typeof cron?.intervalSeconds === 'number' ? cron.intervalSeconds : 60,
    };
  } catch {
    return { enabled: false, intervalSeconds: 60 };
  }
}

function loadAgentCronJobs(): CronJobInfo[] {
  const agents = agentStore.getAllAgents();
  const jobs: CronJobInfo[] = [];

  for (const agent of agents) {
    const wsDir = agentWorkspacePath(agent.id);
    const heartbeatPath = join(wsDir, 'HEARTBEAT.md');
    const hasHeartbeat = existsSync(heartbeatPath);
    let heartbeatPreview = '';

    if (hasHeartbeat) {
      try {
        const content = readFileSync(heartbeatPath, 'utf-8');
        heartbeatPreview = content
          .split('\n')
          .filter((l) => l.trim() && !l.startsWith('#'))
          .slice(0, 3)
          .join(' ')
          .slice(0, 120);
      } catch {
        // Unreadable
      }
    }

    jobs.push({
      agentId: agent.id,
      agentName: agent.name,
      enabled: hasHeartbeat,
      hasHeartbeat,
      heartbeatPreview,
      workspacePath: wsDir,
      lastActive: agent.lastActive || 'Never',
      status: agent.status || 'sleeping',
    });
  }

  return jobs;
}

export function cronRoutes(fastify: FastifyInstance): void {
  // GET /api/cron — Get cron configuration and per-agent heartbeat status
  fastify.get('/api/cron', async () => {
    const cronConfig = loadCronConfig();
    const jobs = loadAgentCronJobs();

    return {
      config: cronConfig,
      jobs,
      summary: {
        totalAgents: jobs.length,
        activeJobs: jobs.filter((j) => j.hasHeartbeat).length,
        disabledJobs: jobs.filter((j) => !j.hasHeartbeat).length,
      },
    };
  });

  // GET /api/cron/:agentId/heartbeat — Get full HEARTBEAT.md content for an agent
  fastify.get<{ Params: { agentId: string } }>('/api/cron/:agentId/heartbeat', async (request) => {
    const { agentId } = request.params;
    const agent = agentStore.getAgentById(agentId);
    if (!agent) return { content: '', exists: false };

    const heartbeatPath = join(agentWorkspacePath(agentId), 'HEARTBEAT.md');
    if (!existsSync(heartbeatPath)) {
      return { content: '', exists: false };
    }

    const content = readFileSync(heartbeatPath, 'utf-8');
    return { content, exists: true, agentId, agentName: agent.name };
  });

  // ── Local cron job management ──────────────────────────

  // GET /api/cron/jobs — List all cron jobs (local disk)
  fastify.get('/api/cron/jobs', async () => {
    const jobs = loadLocalCronJobs();
    return { jobs };
  });

  // POST /api/cron/jobs — Create a new cron job (local)
  fastify.post('/api/cron/jobs', async (request) => {
    const body = request.body as Partial<CronJob>;
    const jobs = loadLocalCronJobs();

    const newJob: CronJob = {
      id: body.id || generateId('cron'),
      name: body.name || 'Untitled Job',
      schedule: body.schedule || { kind: 'cron', expr: '*/30 * * * *' },
      sessionTarget: body.sessionTarget || 'main',
      wakeMode: body.wakeMode,
      payload: body.payload || { kind: 'systemEvent', text: '' },
      delivery: body.delivery,
      agentId: body.agentId,
      deleteAfterRun: body.deleteAfterRun,
      enabled: body.enabled ?? true,
      createdAt: new Date().toISOString(),
    };

    jobs.push(newJob);
    saveLocalCronJobs(jobs);
    return newJob;
  });

  // PUT /api/cron/jobs/:id — Update a cron job (local)
  fastify.put<{ Params: { id: string } }>('/api/cron/jobs/:id', async (request, reply) => {
    const { id } = request.params;
    const body = request.body as Partial<CronJob>;
    const jobs = loadLocalCronJobs();
    const idx = jobs.findIndex((j) => j.id === id);
    if (idx === -1) {
      reply.code(404);
      return { error: 'Cron job not found' };
    }
    jobs[idx] = { ...jobs[idx], ...body, id };
    saveLocalCronJobs(jobs);
    return jobs[idx];
  });

  // DELETE /api/cron/jobs/:id — Remove a cron job (local)
  fastify.delete<{ Params: { id: string } }>('/api/cron/jobs/:id', async (request, reply) => {
    const { id } = request.params;
    const jobs = loadLocalCronJobs();
    const idx = jobs.findIndex((j) => j.id === id);
    if (idx === -1) {
      reply.code(404);
      return { error: 'Cron job not found' };
    }
    jobs.splice(idx, 1);
    saveLocalCronJobs(jobs);
    return { ok: true };
  });

  // POST /api/cron/jobs/:id/run — Trigger an immediate run
  fastify.post<{ Params: { id: string } }>('/api/cron/jobs/:id/run', async (request, reply) => {
    const result = await runJobNow(request.params.id);
    if (!result.ok) {
      reply.code(404);
      return { error: result.error };
    }
    return { ok: true };
  });

  // GET /api/cron/runs — Get recent cron job runs
  fastify.get<{ Querystring: { jobId?: string; limit?: string } }>('/api/cron/runs', async (request) => {
    const { jobId, limit } = request.query;
    let runs = loadCronRuns();

    if (jobId) {
      runs = runs.filter((r) => r.jobId === jobId);
    }

    // Newest first
    runs.reverse();

    const max = limit ? parseInt(limit, 10) : 50;
    if (max > 0) runs = runs.slice(0, max);

    return { runs };
  });

  // GET /api/cron/status — Get overall cron system status
  fastify.get('/api/cron/status', async () => {
    const cronConfig = loadCronConfig();
    const jobs = loadLocalCronJobs();
    const runs = loadCronRuns();
    const lastRun = runs.length > 0 ? runs[runs.length - 1] : null;
    return {
      enabled: cronConfig.enabled,
      intervalSeconds: cronConfig.intervalSeconds,
      totalJobs: jobs.length,
      activeJobs: jobs.filter((j) => j.enabled).length,
      totalRuns: runs.length,
      lastRunAt: lastRun?.startedAt,
    };
  });

  // POST /api/cron/setup-defaults — Create a default "check tasks" cron job per agent
  fastify.post('/api/cron/setup-defaults', async () => {
    const agents = agentStore.getAllAgents();
    if (agents.length === 0) {
      return { created: 0, jobs: [] };
    }

    // Ensure heartbeat config is set in cron-config.json
    ensureHeartbeatConfig();

    // Ensure workspace files (including HEARTBEAT.md) exist and are up-to-date
    for (const agent of agents) {
      try {
        ensureAgentWorkspace(agent);
        updateAgentHeartbeat(agent);
      } catch (err) {
        logger.warn({ err, agentId: agent.id }, 'Failed to sync workspace for agent');
      }
    }

    // Get existing jobs to avoid duplicates
    const existingJobs = loadLocalCronJobs();
    const existingAgentIds = new Set(existingJobs.map((j) => j.agentId).filter(Boolean));
    const created: CronJob[] = [];

    for (const agent of agents) {
      if (existingAgentIds.has(agent.id)) continue;

      const job: CronJob = {
        id: generateId('cron'),
        name: `${agent.name} — Check Tasks`,
        schedule: { kind: 'cron', expr: '*/30 * * * *' },
        sessionTarget: 'main',
        wakeMode: 'now',
        payload: {
          kind: 'systemEvent',
          text: `Check your HEARTBEAT.md and scan for any assigned tasks. Process any pending work.`,
        },
        delivery: { mode: 'none' },
        agentId: agent.id,
        enabled: true,
        createdAt: new Date().toISOString(),
      };
      created.push(job);
    }

    if (created.length > 0) {
      saveLocalCronJobs([...existingJobs, ...created]);
    }

    return { created: created.length, jobs: created };
  });
}
