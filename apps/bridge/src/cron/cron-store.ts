import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { config } from '../config.js';

export interface CronJob {
  id: string;
  name: string;
  schedule: { kind: string; expr?: string; at?: string; everyMs?: number };
  sessionTarget: string;
  wakeMode?: string;
  payload: { kind: string; text?: string; message?: string };
  delivery?: { mode: string; channel?: string; to?: string };
  agentId?: string;
  deleteAfterRun?: boolean;
  enabled?: boolean;
  createdAt?: string;
  lastRunAt?: string;
  nextRunAt?: string;
  runCount?: number;
}

export interface CronRunRecord {
  id: string;
  jobId: string;
  jobName: string;
  agentId: string;
  conversationId: string;
  status: 'success' | 'running' | 'failed';
  startedAt: string;
  finishedAt?: string;
  duration?: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Jobs persistence
// ---------------------------------------------------------------------------

export function cronJobsPath(): string {
  return join(dirname(config.agentWorkspacesDir), 'cron', 'jobs.json');
}

export function loadLocalCronJobs(): CronJob[] {
  try {
    const jobsPath = cronJobsPath();
    if (existsSync(jobsPath)) {
      const data = JSON.parse(readFileSync(jobsPath, 'utf-8'));
      return Array.isArray(data.jobs) ? data.jobs : [];
    }
  } catch { /* ignore */ }
  return [];
}

export function saveLocalCronJobs(jobs: CronJob[]): void {
  const jobsPath = cronJobsPath();
  const dir = dirname(jobsPath);
  mkdirSync(dir, { recursive: true });
  writeFileSync(jobsPath, JSON.stringify({ jobs }, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// Run history persistence
// ---------------------------------------------------------------------------

const MAX_RUN_RECORDS = 200;

function cronRunsPath(): string {
  return join(dirname(config.agentWorkspacesDir), 'cron', 'runs.json');
}

export function loadCronRuns(): CronRunRecord[] {
  try {
    const runsPath = cronRunsPath();
    if (existsSync(runsPath)) {
      const data = JSON.parse(readFileSync(runsPath, 'utf-8'));
      return Array.isArray(data.runs) ? data.runs : [];
    }
  } catch { /* ignore */ }
  return [];
}

export function saveCronRuns(runs: CronRunRecord[]): void {
  // Keep bounded
  const trimmed = runs.slice(-MAX_RUN_RECORDS);
  const runsPath = cronRunsPath();
  const dir = dirname(runsPath);
  mkdirSync(dir, { recursive: true });
  writeFileSync(runsPath, JSON.stringify({ runs: trimmed }, null, 2), 'utf-8');
}

export function appendCronRun(record: CronRunRecord): void {
  const runs = loadCronRuns();
  runs.push(record);
  saveCronRuns(runs);
}

export function completeCronRun(runId: string, status: 'success' | 'failed', error?: string): void {
  const runs = loadCronRuns();
  const idx = runs.findIndex((r) => r.id === runId);
  if (idx === -1) return;
  const now = new Date();
  runs[idx].status = status;
  runs[idx].finishedAt = now.toISOString();
  runs[idx].duration = now.getTime() - new Date(runs[idx].startedAt).getTime();
  if (error) runs[idx].error = error;
  saveCronRuns(runs);
}
