import { logger } from '../utils/logger.js';
import { eventBus } from '../events/bus.js';
import { loadLocalCronJobs, saveLocalCronJobs, CronJob, appendCronRun, completeCronRun } from './cron-store.js';
import { runAgent, isAgentRunning } from '../sdk/agent-runner.js';
import * as conversationStore from '../store/entities/conversations.js';
import * as agentStore from '../store/entities/agents.js';
import { generateId } from '../utils/id.js';

// ---------------------------------------------------------------------------
// Cron expression matching (no external deps)
// Supports: *, */N, N, N-M, N,M,O
// ---------------------------------------------------------------------------

function matchField(field: string, value: number, max: number): boolean {
  for (const part of field.split(',')) {
    const trimmed = part.trim();
    if (trimmed === '*') return true;

    // */N  — every N
    if (trimmed.startsWith('*/')) {
      const step = parseInt(trimmed.slice(2), 10);
      if (!isNaN(step) && step > 0 && value % step === 0) return true;
      continue;
    }

    // N-M  — range
    if (trimmed.includes('-')) {
      const [lo, hi] = trimmed.split('-').map(Number);
      if (!isNaN(lo) && !isNaN(hi) && value >= lo && value <= hi) return true;
      continue;
    }

    // Literal
    if (parseInt(trimmed, 10) === value) return true;
  }
  return false;
}

function cronExpressionMatches(expr: string, date: Date): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length < 5) return false;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  return (
    matchField(minute, date.getMinutes(), 59) &&
    matchField(hour, date.getHours(), 23) &&
    matchField(dayOfMonth, date.getDate(), 31) &&
    matchField(month, date.getMonth() + 1, 12) &&
    matchField(dayOfWeek, date.getDay(), 6)
  );
}

// ---------------------------------------------------------------------------
// Scheduler state
// ---------------------------------------------------------------------------

let tickTimer: ReturnType<typeof setInterval> | null = null;

const TICK_INTERVAL_MS = 30_000; // 30 seconds

// ---------------------------------------------------------------------------
// Heartbeat conversation helpers
// ---------------------------------------------------------------------------

function heartbeatConversationId(agentId: string): string {
  return `heartbeat-${agentId}`;
}

function ensureHeartbeatConversation(agentId: string): string {
  const id = heartbeatConversationId(agentId);
  const existing = conversationStore.getConversation(id);
  if (existing) return id;

  conversationStore.createConversation({
    id,
    title: 'Heartbeat',
    agentId,
    mode: 'single',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messageCount: 0,
  });
  logger.info({ agentId, conversationId: id }, 'Created heartbeat conversation');
  return id;
}

// ---------------------------------------------------------------------------
// Job execution
// ---------------------------------------------------------------------------

function shouldRun(job: CronJob, now: Date): boolean {
  if (!job.enabled) return false;
  if (!job.agentId) return false;

  const schedule = job.schedule;

  if (schedule.kind === 'cron' && schedule.expr) {
    if (!cronExpressionMatches(schedule.expr, now)) return false;

    // Dedup: skip if lastRunAt is in the same minute
    if (job.lastRunAt) {
      const lastRun = new Date(job.lastRunAt);
      if (
        lastRun.getFullYear() === now.getFullYear() &&
        lastRun.getMonth() === now.getMonth() &&
        lastRun.getDate() === now.getDate() &&
        lastRun.getHours() === now.getHours() &&
        lastRun.getMinutes() === now.getMinutes()
      ) {
        return false;
      }
    }
    return true;
  }

  if (schedule.kind === 'interval' && schedule.everyMs) {
    if (!job.lastRunAt) return true; // Never ran — run now
    const elapsed = now.getTime() - new Date(job.lastRunAt).getTime();
    return elapsed >= schedule.everyMs;
  }

  if (schedule.kind === 'once' && schedule.at) {
    if (job.lastRunAt) return false; // Already ran
    return now.getTime() >= new Date(schedule.at).getTime();
  }

  return false;
}

async function executeJob(job: CronJob): Promise<void> {
  const agentId = job.agentId!;
  const conversationId = ensureHeartbeatConversation(agentId);

  // Skip if agent is already running on this conversation
  if (isAgentRunning(agentId, conversationId)) {
    logger.info({ jobId: job.id, agentId }, 'Cron skipped — agent busy');
    eventBus.broadcast({
      type: 'cron.skipped',
      payload: { jobId: job.id, agentId, reason: 'agent_busy' },
    });
    return;
  }

  const message = job.payload.text || job.payload.message || 'Check your HEARTBEAT.md and scan for any assigned tasks.';

  // Record the run
  const runId = generateId('run');
  appendCronRun({
    id: runId,
    jobId: job.id,
    jobName: job.name,
    agentId,
    conversationId,
    status: 'running',
    startedAt: new Date().toISOString(),
  });

  logger.info({ jobId: job.id, agentId, conversationId }, 'Cron firing job');
  eventBus.broadcast({
    type: 'cron.fired',
    payload: { jobId: job.id, agentId, conversationId, runId },
  });

  // Fire-and-forget, but track completion via agent.result event
  runAgent(agentId, conversationId, message)
    .then(() => {
      completeCronRun(runId, 'success');
    })
    .catch((err) => {
      logger.error({ err, jobId: job.id, agentId }, 'Cron job agent run failed');
      completeCronRun(runId, 'failed', String(err));
    });
}

// ---------------------------------------------------------------------------
// Tick
// ---------------------------------------------------------------------------

function tick(): void {
  const now = new Date();
  const jobs = loadLocalCronJobs();
  let dirty = false;

  for (const job of jobs) {
    if (!shouldRun(job, now)) continue;

    job.lastRunAt = now.toISOString();
    job.runCount = (job.runCount ?? 0) + 1;
    dirty = true;

    executeJob(job).catch((err) => {
      logger.error({ err, jobId: job.id }, 'Cron executeJob error');
    });

    // Handle deleteAfterRun (one-shot jobs)
    if (job.deleteAfterRun) {
      job.enabled = false;
    }
  }

  if (dirty) {
    saveLocalCronJobs(jobs);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function ensureDefaultHeartbeats(): { agentsChecked: number; jobsCreated: number; agentIds: string[] } {
  const agents = agentStore.getAllAgents();
  const jobs = loadLocalCronJobs();
  const createdIds: string[] = [];

  const agentsWithJob = new Set(jobs.filter((j) => j.agentId).map((j) => j.agentId!));

  for (const agent of agents) {
    if (agentsWithJob.has(agent.id)) continue;

    const heartbeatJob: CronJob = {
      id: generateId('cron'),
      name: `${agent.name} — Heartbeat`,
      schedule: { kind: 'cron', expr: '*/30 * * * *' },
      sessionTarget: 'heartbeat',
      wakeMode: 'now',
      payload: {
        kind: 'systemEvent',
        text: 'Check your HEARTBEAT.md and scan for any assigned tasks. Process any pending work.',
      },
      delivery: { mode: 'none' },
      agentId: agent.id,
      enabled: true,
      createdAt: new Date().toISOString(),
    };
    jobs.push(heartbeatJob);
    createdIds.push(agent.id);
  }

  if (createdIds.length > 0) {
    saveLocalCronJobs(jobs);
    logger.info({ created: createdIds.length, agentIds: createdIds }, 'Created missing default heartbeat cron jobs');
  }

  return { agentsChecked: agents.length, jobsCreated: createdIds.length, agentIds: createdIds };
}

export function startScheduler(): void {
  if (tickTimer) return;
  tickTimer = setInterval(tick, TICK_INTERVAL_MS);
  logger.info({ intervalMs: TICK_INTERVAL_MS }, 'Cron scheduler started');

  // Run first tick immediately (on next event loop turn)
  setTimeout(tick, 0);
}

export function stopScheduler(): void {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
    logger.info('Cron scheduler stopped');
  }
}

export async function runJobNow(jobId: string): Promise<{ ok: boolean; error?: string }> {
  const jobs = loadLocalCronJobs();
  const job = jobs.find((j) => j.id === jobId);
  if (!job) return { ok: false, error: 'Job not found' };
  if (!job.agentId) return { ok: false, error: 'Job has no agentId' };

  job.lastRunAt = new Date().toISOString();
  saveLocalCronJobs(jobs);

  await executeJob(job);
  return { ok: true };
}
