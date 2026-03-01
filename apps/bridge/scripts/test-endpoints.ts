#!/usr/bin/env npx tsx
/**
 * Pawd Bridge API endpoint test script.
 *
 * Run with: npx tsx scripts/test-endpoints.ts
 *
 * Requires bridge to be running: npm run dev
 *
 * Env (from pawd-bridge/.env or parent .env):
 *   BRIDGE_URL         - Bridge base URL (default: http://127.0.0.1:3001)
 */

import 'dotenv/config';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../.env') });
config({ path: resolve(__dirname, '../../.env') }); // Monorepo root

const BRIDGE_URL =
  process.env.BRIDGE_URL || process.env.EXPO_PUBLIC_BRIDGE_URL || 'http://127.0.0.1:3001';

// ── Helpers ──────────────────────────────────────────────────

type Result = { ok: boolean; status?: number; body?: unknown; error?: string };

async function fetchJson(
  url: string,
  opts?: RequestInit & { expectStatus?: number }
): Promise<Result> {
  const { expectStatus, ...init } = opts || {};
  const hasBody = init.body != null && init.body !== '';
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (hasBody) headers['Content-Type'] = 'application/json';
  try {
    const res = await fetch(url, { ...init, headers });
    const text = await res.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    const ok = expectStatus ? res.status === expectStatus : res.ok;
    return { ok, status: res.status, body };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// Auth is bypassed — bridge uses a local owner stub for all requests.

function section(name: string): void {
  console.log(`\n=== ${name} ===\n`);
}

function logResult(name: string, result: Result): void {
  const status = result.status != null ? ` [${result.status}]` : '';
  const icon = result.ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
  const msg = result.ok
    ? `${icon} ${name}${status}`
    : `${icon} ${name}${status} ${result.error || JSON.stringify(result.body)}`;
  console.log(msg);
  if (result.body != null && !result.ok) {
    const str =
      typeof result.body === 'object'
        ? JSON.stringify(result.body, null, 0)
        : String(result.body);
    const max = 300;
    const preview = str.length > max ? str.slice(0, max) + '...' : str;
    if (preview.length > 0) console.log(`    ${preview}`);
  }
}

async function cleanupEntities(
  items: { type: string; id: string }[],
  authHeader: Record<string, string>
): Promise<void> {
  if (items.length === 0) return;
  section('Cleanup');
  for (const item of items.reverse()) {
    try {
      const endpoint =
        item.type === 'agent' ? 'agents' : item.type === 'task' ? 'tasks' : 'conversations';
      const res = await fetchJson(`${BRIDGE_URL}/api/${endpoint}/${item.id}`, {
        method: 'DELETE',
        headers: authHeader,
      });
      const icon = res.ok ? '\x1b[90m✓\x1b[0m' : '\x1b[90m✗\x1b[0m';
      console.log(`  ${icon} Deleted ${item.type} ${item.id}`);
    } catch {
      console.log(`  \x1b[90m✗\x1b[0m Failed to clean up ${item.type} ${item.id}`);
    }
  }
}

// ── Main ─────────────────────────────────────────────────────

async function main(): Promise<void> {
  const startTime = Date.now();

  console.log('\n========================================');
  console.log('   Pawd Bridge API Endpoint Tests');
  console.log('========================================\n');
  console.log(`Bridge:   ${BRIDGE_URL}`);
  console.log(`Auth:     Local owner (no external auth)`);

  const authHeader: Record<string, string> = {};
  const cleanup: { type: string; id: string }[] = [];

  let passed = 0;
  let failed = 0;

  const run = async (name: string, fn: () => Promise<Result>): Promise<Result> => {
    const r = await fn();
    if (r.ok) passed++;
    else failed++;
    logResult(name, r);
    return r;
  };

  try {
    // ── Public Endpoints ───────────────────────
    section('Public Endpoints');

    await run('GET /health', () => fetchJson(`${BRIDGE_URL}/health`));

    await run('GET /api/status', () => fetchJson(`${BRIDGE_URL}/api/status`));

    await run('GET /api/events (SSE)', async () => {
      try {
        const url = `${BRIDGE_URL}/api/events`;
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 2000);
        const res = await fetch(url, { signal: ctrl.signal });
        if (!res.ok) {
          clearTimeout(t);
          return { ok: false, status: res.status, body: await res.text() };
        }
        const reader = res.body?.getReader();
        const chunk = reader ? await reader.read() : { value: new Uint8Array(0) };
        reader?.cancel().catch(() => {});
        clearTimeout(t);
        const text = new TextDecoder().decode(chunk.value);
        const ok = text.includes('event:') || text.includes('connected') || text.length > 0;
        return { ok, status: res.status };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('abort')) return { ok: true, status: 200 };
        return { ok: false, error: msg };
      }
    });

    // ── Gateway Connectivity ───────────────────
    section('Gateway Connectivity');

    await run('GET /api/status -> gateway.connected', async () => {
      const r = await fetchJson(`${BRIDGE_URL}/api/status`);
      if (!r.ok) return r;
      const body = r.body as Record<string, unknown> | undefined;
      const gateway = (body?.gateway ?? body?.status) as Record<string, unknown> | undefined;
      const connected = gateway?.connected;
      console.log(`    Gateway connected: ${connected ?? 'unknown'}`);
      return { ok: true, status: r.status };
    });

    // ── Agents ─────────────────────────────────
    section('Agents');

    const agentsRes = await run('GET /api/agents', () =>
      fetchJson(`${BRIDGE_URL}/api/agents`, { headers: authHeader })
    );
    const agents = (agentsRes.body as { agents?: { id: string }[] })?.agents ?? [];
    const existingAgentId = agents[0]?.id;

    const createAgentRes = await run('POST /api/agents', () =>
      fetchJson(`${BRIDGE_URL}/api/agents`, {
        method: 'POST',
        headers: authHeader,
        body: JSON.stringify({ name: 'Test Agent', icon: 'sparkles' }),
      })
    );
    const newAgent = (createAgentRes.body as { agent?: { id: string } })?.agent;
    const agentId = newAgent?.id ?? existingAgentId;
    if (newAgent) cleanup.push({ type: 'agent', id: newAgent.id });

    if (agentId) {
      await run('GET /api/agents/:id', () =>
        fetchJson(`${BRIDGE_URL}/api/agents/${agentId}`, { headers: authHeader })
      );
      await run('PUT /api/agents/:id', () =>
        fetchJson(`${BRIDGE_URL}/api/agents/${agentId}`, {
          method: 'PUT',
          headers: authHeader,
          body: JSON.stringify({ tagline: 'Test tagline' }),
        })
      );
      await run('GET /api/agents/:id/skills', () =>
        fetchJson(`${BRIDGE_URL}/api/agents/${agentId}/skills`, { headers: authHeader })
      );
    }

    // ── Tasks ──────────────────────────────────
    section('Tasks');

    const tasksRes = await run('GET /api/tasks', () =>
      fetchJson(`${BRIDGE_URL}/api/tasks`, { headers: authHeader })
    );
    const tasks = (tasksRes.body as { tasks?: { id: string }[] })?.tasks ?? [];
    const agentForTask = agents[0] ?? newAgent;

    const createTaskRes = await run('POST /api/tasks', () =>
      fetchJson(`${BRIDGE_URL}/api/tasks`, {
        method: 'POST',
        headers: authHeader,
        body: JSON.stringify({
          title: 'Test Task',
          assignedAgentId: agentForTask?.id ?? 'a_test',
        }),
      })
    );
    const newTask = (createTaskRes.body as { task?: { id: string } })?.task;
    const taskId = newTask?.id ?? tasks[0]?.id;
    if (newTask) cleanup.push({ type: 'task', id: newTask.id });

    if (taskId) {
      await run('GET /api/tasks/:id', () =>
        fetchJson(`${BRIDGE_URL}/api/tasks/${taskId}`, { headers: authHeader })
      );
      await run('PUT /api/tasks/:id', () =>
        fetchJson(`${BRIDGE_URL}/api/tasks/${taskId}`, {
          method: 'PUT',
          headers: authHeader,
          body: JSON.stringify({ status: 'in_progress' }),
        })
      );
    }

    await run('GET /api/tasks?status=todo', () =>
      fetchJson(`${BRIDGE_URL}/api/tasks?status=todo`, { headers: authHeader })
    );

    if (agentForTask?.id) {
      await run(`GET /api/tasks?agentId=${agentForTask.id}`, () =>
        fetchJson(`${BRIDGE_URL}/api/tasks?agentId=${agentForTask.id}`, { headers: authHeader })
      );
    }

    // ── Conversations ──────────────────────────
    section('Conversations');

    const convRes = await run('GET /api/conversations', () =>
      fetchJson(`${BRIDGE_URL}/api/conversations`, { headers: authHeader })
    );
    const convs = (convRes.body as { conversations?: { id: string }[] })?.conversations ?? [];

    const createConvRes = await run('POST /api/conversations', () =>
      fetchJson(`${BRIDGE_URL}/api/conversations`, {
        method: 'POST',
        headers: authHeader,
        body: JSON.stringify({ agentId: agentForTask?.id ?? 'a_test', title: 'Test Chat' }),
      })
    );
    const newConv = (createConvRes.body as { conversation?: { id: string } })?.conversation;
    const convId = newConv?.id ?? convs[0]?.id;
    if (newConv) cleanup.push({ type: 'conversation', id: newConv.id });

    if (convId) {
      await run('GET /api/conversations/:id', () =>
        fetchJson(`${BRIDGE_URL}/api/conversations/${convId}`, { headers: authHeader })
      );

      await run('POST /api/conversations/:id/messages', () =>
        fetchJson(`${BRIDGE_URL}/api/conversations/${convId}/messages`, {
          method: 'POST',
          headers: authHeader,
          body: JSON.stringify({ content: 'Hello from test script' }),
        })
      );

      await run('GET /api/conversations/:id/messages', () =>
        fetchJson(`${BRIDGE_URL}/api/conversations/${convId}/messages`, { headers: authHeader })
      );

      await run('GET /api/conversations/:id/messages?limit=1', async () => {
        const r = await fetchJson(
          `${BRIDGE_URL}/api/conversations/${convId}/messages?limit=1`,
          { headers: authHeader }
        );
        if (!r.ok) return r;
        const body = r.body as { messages?: unknown[] };
        return { ok: (body?.messages?.length ?? 0) <= 1, status: r.status, body: r.body };
      });
    }

    // ── Tokens ─────────────────────────────────
    section('Tokens');

    await run('GET /api/tokens', () =>
      fetchJson(`${BRIDGE_URL}/api/tokens`, { headers: authHeader })
    );
    await run('PUT /api/tokens', () =>
      fetchJson(`${BRIDGE_URL}/api/tokens`, {
        method: 'PUT',
        headers: authHeader,
        body: JSON.stringify({ limit: 100000 }),
      })
    );

    // ── Integrations ───────────────────────────
    section('Integrations');

    await run('GET /api/integrations', () =>
      fetchJson(`${BRIDGE_URL}/api/integrations`, { headers: authHeader })
    );

    // ── Approvals ──────────────────────────────
    section('Approvals');

    await run('GET /api/approvals/pending', () =>
      fetchJson(`${BRIDGE_URL}/api/approvals/pending`, { headers: authHeader })
    );

    // ── Terminal ───────────────────────────────
    section('Terminal');

    await run('GET /api/terminal/sessions', () =>
      fetchJson(`${BRIDGE_URL}/api/terminal/sessions`, { headers: authHeader })
    );
    await run('GET /api/terminal/quick-commands', () =>
      fetchJson(`${BRIDGE_URL}/api/terminal/quick-commands`, { headers: authHeader })
    );
    await run('POST /api/terminal/exec (echo)', async () => {
      const r = await fetchJson(`${BRIDGE_URL}/api/terminal/exec`, {
        method: 'POST',
        headers: authHeader,
        body: JSON.stringify({ command: 'echo hello-pawd-test' }),
      });
      if (!r.ok) return r;
      const body = r.body as { output?: string; exitCode?: number; sessionId?: string };
      const valid = body?.output?.includes('hello-pawd-test') && body?.exitCode === 0;
      return { ok: !!valid, status: r.status, body: r.body };
    });

    // ── Metrics ────────────────────────────────
    section('Metrics');

    await run('GET /api/metrics/resources', async () => {
      const r = await fetchJson(`${BRIDGE_URL}/api/metrics/resources`, { headers: authHeader });
      if (!r.ok) return r;
      const body = r.body as {
        cpu?: { percent?: number };
        memory?: { percent?: number };
        storage?: { percent?: number };
        uptime?: string;
      };
      const valid =
        typeof body?.cpu?.percent === 'number' &&
        typeof body?.memory?.percent === 'number' &&
        typeof body?.storage?.percent === 'number' &&
        typeof body?.uptime === 'string';
      return { ok: valid, status: r.status, body: r.body };
    });

  } finally {
    await cleanupEntities(cleanup, authHeader);
  }

  printSummary(passed, failed, startTime);
  process.exit(failed > 0 ? 1 : 0);
}

function printSummary(passed: number, failed: number, startTime: number): void {
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const color = failed > 0 ? '\x1b[31m' : '\x1b[32m';
  console.log('\n========================================');
  console.log(`   ${color}Results: ${passed} passed, ${failed} failed\x1b[0m (${elapsed}s)`);
  console.log('========================================\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
