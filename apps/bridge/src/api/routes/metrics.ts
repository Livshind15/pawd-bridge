import { spawn } from 'child_process';
import { FastifyInstance } from 'fastify';

/**
 * Collects CPU, memory, and storage metrics from the local VM.
 * Uses standard Linux tools: top, free, df, /proc/uptime
 */
const METRICS_SCRIPT = [
  'cpu_line=$(top -bn1 2>/dev/null | grep "Cpu(s)" || true)',
  'cpu_idle=$(echo "$cpu_line" | sed -n "s/.*, *\\([0-9.]*\\)%* *id.*/\\1/p" | head -1)',
  'cpu_idle=${cpu_idle:-0}',
  'mem_line=$(free -m 2>/dev/null | awk "/^Mem:/{print \\$2,\\$3}")',
  'mem_total=$(echo "$mem_line" | awk "{print \\$1}")',
  'mem_used=$(echo "$mem_line" | awk "{print \\$2}")',
  'mem_total=${mem_total:-1}',
  'mem_pct=$(awk "BEGIN {printf \\"%.0f\\", ($mem_used/$mem_total)*100}")',
  'swap_line=$(free -m 2>/dev/null | awk "/^Swap:/{print \\$2,\\$3}")',
  'swap_total=$(echo "$swap_line" | awk "{print \\$1}")',
  'swap_used=$(echo "$swap_line" | awk "{print \\$2}")',
  'swap_total=${swap_total:-0}',
  'swap_used=${swap_used:-0}',
  'uptime_sec=$(awk "{print int(\\$1)}" /proc/uptime 2>/dev/null)',
  'uptime_sec=${uptime_sec:-0}',
  'cpu_pct=$(awk "BEGIN {printf \\"%.0f\\", 100 - $cpu_idle}")',
  'storage_line=$(df -k / 2>/dev/null | tail -1)',
  'storage_total_mb=$(echo "$storage_line" | awk "{printf \\"%d\\", \\$2/1024}")',
  'storage_used_mb=$(echo "$storage_line" | awk "{printf \\"%d\\", \\$3/1024}")',
  'storage_pct=$(echo "$storage_line" | awk "{gsub(/%/,\\"\\",\\$5); print \\$5+0}")',
  'storage_total_mb=${storage_total_mb:-1}',
  'storage_used_mb=${storage_used_mb:-0}',
  'storage_pct=${storage_pct:-0}',
  'top2_cpu=$(ps -eo %cpu,comm --no-headers 2>/dev/null | sort -rn | head -2 | awk \'{gsub(/[,"\\\\]/, "", $2); printf "%s:%.0f,", $2, $1+0}\' | sed \'s/,$//\')',
  'top2_mem=$(ps -eo rss,comm --no-headers 2>/dev/null | sort -rnk1 | head -2 | awk \'{gsub(/[,"\\\\]/, "", $2); printf "%s:%.1f,", $2, $1/1024}\' | sed \'s/,$//\')',
  'top2_cpu=${top2_cpu:-}',
  'top2_mem=${top2_mem:-}',
  'echo "{\\"cpu_percent\\":$cpu_pct,\\"mem_percent\\":$mem_pct,\\"mem_used\\":$mem_used,\\"mem_total\\":$mem_total,\\"swap_used\\":$swap_used,\\"swap_total\\":$swap_total,\\"uptime_sec\\":$uptime_sec,\\"storage_used\\":$storage_used_mb,\\"storage_total\\":$storage_total_mb,\\"storage_percent\\":$storage_pct,\\"top2_cpu\\":\\""$top2_cpu"\\",\\"top2_mem\\":\\""$top2_mem"\\"}"',
].join('\n');

export interface TopProcess {
  name: string;
  value: string; // CPU % or RAM in MB
}

export interface VMMetrics {
  cpu: {
    percent: number;
    alertThreshold: number;
    cpuAlert: boolean;
    breakdown?: string;
    topProcesses: TopProcess[];
  };
  memory: {
    percent: number;
    ram: string;
    swap: string;
    topProcesses: TopProcess[];
  };
  storage: {
    percent: number;
    total: string;
  };
  uptime: string;
}

// Track when CPU first exceeded the alert threshold
let cpuAboveThresholdSince: number | null = null;
const CPU_ALERT_DURATION_MS = 5 * 60 * 1000; // 5 minutes

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatMemory(used: number, total: number): string {
  if (total >= 1024) {
    return `${(used / 1024).toFixed(1)}GB/${(total / 1024).toFixed(1)}GB`;
  }
  return `${used}MB/${total}MB`;
}

function formatStorage(usedMb: number, totalMb: number): string {
  if (totalMb >= 1024) {
    return `${(usedMb / 1024).toFixed(1)}GB/${(totalMb / 1024).toFixed(1)}GB`;
  }
  return `${usedMb}MB/${totalMb}MB`;
}

function parseTopProcesses(str: string, suffix: string): TopProcess[] {
  if (!str || typeof str !== 'string') return [];
  return str
    .split(',')
    .filter(Boolean)
    .map((part) => {
      const colon = part.indexOf(':');
      if (colon === -1) return null;
      const name = part.slice(0, colon).trim() || '?';
      const value = part.slice(colon + 1).trim();
      return { name, value: value ? `${value}${suffix}` : '0' + suffix };
    })
    .filter((p): p is TopProcess => p !== null)
    .slice(0, 2);
}

function parseMetricsOutput(output: string): VMMetrics | null {
  try {
    const raw = JSON.parse(output.trim()) as {
      cpu_percent?: number;
      mem_percent?: number;
      mem_used?: number;
      mem_total?: number;
      swap_used?: number;
      swap_total?: number;
      uptime_sec?: number;
      storage_used?: number;
      storage_total?: number;
      storage_percent?: number;
      top2_cpu?: string;
      top2_mem?: string;
    };

    const memUsed = raw.mem_used ?? 0;
    const memTotal = Math.max(raw.mem_total ?? 1, 1);
    const memPercent = raw.mem_percent ?? Math.round((memUsed / memTotal) * 100);
    const swapUsed = raw.swap_used ?? 0;
    const swapTotal = raw.swap_total ?? 0;
    const cpuPercent = Math.min(100, Math.max(0, raw.cpu_percent ?? 0));
    const uptimeSec = raw.uptime_sec ?? 0;

    const storageUsed = raw.storage_used ?? 0;
    const storageTotal = Math.max(raw.storage_total ?? 1, 1);
    const storagePercent = Math.min(
      100,
      Math.max(0, raw.storage_percent ?? Math.round((storageUsed / storageTotal) * 100))
    );

    const top2Cpu = parseTopProcesses(raw.top2_cpu ?? '', '%');
    const top2Mem = parseTopProcesses(raw.top2_mem ?? '', 'MB');

    const alertThreshold = 80;
    const now = Date.now();

    if (cpuPercent >= alertThreshold) {
      if (cpuAboveThresholdSince === null) {
        cpuAboveThresholdSince = now;
      }
    } else {
      cpuAboveThresholdSince = null;
    }

    const cpuAlert =
      cpuAboveThresholdSince !== null &&
      now - cpuAboveThresholdSince >= CPU_ALERT_DURATION_MS;

    return {
      cpu: {
        percent: Math.round(cpuPercent),
        alertThreshold,
        cpuAlert,
        topProcesses: top2Cpu,
      },
      memory: {
        percent: Math.round(memPercent),
        ram: formatMemory(memUsed, memTotal),
        swap: swapTotal > 0 ? formatMemory(swapUsed, swapTotal) : '0/0',
        topProcesses: top2Mem,
      },
      storage: {
        percent: Math.round(storagePercent),
        total: formatStorage(storageUsed, storageTotal),
      },
      uptime: formatUptime(uptimeSec),
    };
  } catch {
    return null;
  }
}

function execLocal(command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('/bin/sh', ['-c', command], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve(stdout + (stderr ? stderr : ''));
    });
  });
}

export function metricsRoutes(fastify: FastifyInstance): void {
  // GET /api/metrics/resources - CPU and memory from VM (executed locally, same VM)
  fastify.get('/api/metrics/resources', async () => {
    const output = await execLocal(METRICS_SCRIPT);
    const metrics = parseMetricsOutput(output);

    if (!metrics) {
      return {
        cpu: { percent: 0, alertThreshold: 80, cpuAlert: false, topProcesses: [] },
        memory: { percent: 0, ram: '0/0', swap: '0/0', topProcesses: [] },
        storage: { percent: 0, total: '0/0' },
        uptime: '0m',
        error: 'Failed to parse VM metrics',
      };
    }

    return metrics;
  });
}
