import { FastifyInstance } from 'fastify';
import * as agentStore from '../../store/entities/agents.js';
import { NotFoundError, ValidationError } from '../middleware/errors.js';
import { generateId } from '../../utils/id.js';
import {
  syncAgentToWorkspace,
  removeAgentFromWorkspace,
  loadWorkspaceSkillIds,
  syncAgentsRegistry,
  ensureAgentWorkspace as ensureOcWorkspace,
  removeAgentWorkspace as removeOcWorkspace,
} from '../../store/workspace.js';
import {
  ensureAgentWorkspace as ensureSdkWorkspace,
  removeAgentWorkspace as removeSdkWorkspace,
  syncIdentityToAgent,
  agentWorkspacePath as sdkWorkspacePath,
  deleteAllForAgent,
  listSkills as listSdkSkills,
} from '../../sdk/index.js';
import { loadLocalCronJobs, saveLocalCronJobs, CronJob } from '../../cron/cron-store.js';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'fs';
import { createHash } from 'crypto';
import { join } from 'path';

function computeFileHash(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

export function agentRoutes(fastify: FastifyInstance): void {
  // GET /api/agents
  fastify.get('/api/agents', async () => {
    const agents = agentStore.getAllAgents();
    const wsSkills = loadWorkspaceSkillIds();

    // Enrich agents with workspace skill counts
    const enriched = agents.map((a) => {
      const existingCount = (a.skills ?? []).length;
      return { ...a, skillsCount: existingCount + wsSkills.length };
    });

    return { agents: enriched };
  });

  // GET /api/agents/:id
  fastify.get<{ Params: { id: string } }>('/api/agents/:id', async (request) => {
    const agent = agentStore.getAgentById(request.params.id);
    if (!agent) throw new NotFoundError('Agent', request.params.id);
    const wsSkills = loadWorkspaceSkillIds();
    const existingCount = (agent.skills ?? []).length;
    return { agent: { ...agent, skillsCount: existingCount + wsSkills.length } };
  });

  // POST /api/agents
  fastify.post<{ Body: Partial<agentStore.AgentData> }>('/api/agents', async (request) => {
    const body = request.body as Partial<agentStore.AgentData>;
    if (!body.name) throw new ValidationError('Agent name is required');

    const agent: agentStore.AgentData = {
      id: body.id || generateId('a'),
      name: body.name,
      icon: body.icon || 'sparkles',
      role: body.role || 'assistant',
      roleLabel: body.roleLabel || 'Assistant',
      tagline: body.tagline || '',
      description: body.description || '',
      status: body.status || 'sleeping',
      accentColor: body.accentColor || '#6B7280',
      bgColor: body.bgColor || '#F3F4F6',
      skillsCount: body.skillsCount || 0,
      lastActive: body.lastActive || 'Never',
      missionsCompleted: body.missionsCompleted || 0,
      tokensUsed: body.tokensUsed || 0,
      avgMissionTime: body.avgMissionTime || '0m',
      avatar: body.avatar || '',
      skills: body.skills || [],
    };

    const created = agentStore.createAgent(agent);
    syncAgentToWorkspace(created);
    // Agent registered locally (SDK migration - no gateway sync needed)
    ensureOcWorkspace(created);
    ensureSdkWorkspace(created.id);
    syncAgentsRegistry(agentStore.getAllAgents());

    // Auto-create default heartbeat cron job for this agent
    const existingJobs = loadLocalCronJobs();
    const alreadyHasJob = existingJobs.some((j) => j.agentId === created.id);
    if (!alreadyHasJob) {
      const heartbeatJob: CronJob = {
        id: generateId('cron'),
        name: `${created.name} — Heartbeat`,
        schedule: { kind: 'cron', expr: '*/30 * * * *' },
        sessionTarget: 'heartbeat',
        wakeMode: 'now',
        payload: {
          kind: 'systemEvent',
          text: 'Check your HEARTBEAT.md and scan for any assigned tasks. Process any pending work.',
        },
        delivery: { mode: 'none' },
        agentId: created.id,
        enabled: true,
        createdAt: new Date().toISOString(),
      };
      saveLocalCronJobs([...existingJobs, heartbeatJob]);
    }

    return { agent: created };
  });

  // PUT /api/agents/:id
  fastify.put<{ Params: { id: string }; Body: Partial<agentStore.AgentData> }>(
    '/api/agents/:id',
    async (request) => {
      const updated = agentStore.updateAgent(request.params.id, request.body as Partial<agentStore.AgentData>);
      if (!updated) throw new NotFoundError('Agent', request.params.id);
      syncAgentToWorkspace(updated);
      ensureSdkWorkspace(updated.id);
      syncAgentsRegistry(agentStore.getAllAgents());

      // Regenerate personality files directly in the SDK workspace (the single source of truth)
      const wsDir = sdkWorkspacePath(updated.id);
      mkdirSync(wsDir, { recursive: true });

      // Import template builders inline to avoid circular deps
      const { buildIdentityContent, buildHeartbeatContent, buildSoulContent } = await import('../../templates/heartbeat.js');
      writeFileSync(join(wsDir, 'IDENTITY.md'), buildIdentityContent(updated), 'utf-8');
      writeFileSync(join(wsDir, 'HEARTBEAT.md'), buildHeartbeatContent(updated.id, updated.name), 'utf-8');
      writeFileSync(join(wsDir, 'SOUL.md'), buildSoulContent(updated.name), 'utf-8');

      return { agent: updated };
    }
  );

  // DELETE /api/agents/:id
  fastify.delete<{ Params: { id: string } }>('/api/agents/:id', async (request) => {
    const deleted = agentStore.deleteAgent(request.params.id);
    if (!deleted) throw new NotFoundError('Agent', request.params.id);
    removeAgentFromWorkspace(request.params.id);
    // Agent unregistered locally (SDK migration - no gateway sync needed)
    removeOcWorkspace(request.params.id);
    removeSdkWorkspace(request.params.id);
    deleteAllForAgent(request.params.id);
    syncAgentsRegistry(agentStore.getAllAgents());

    // Remove all cron jobs belonging to this agent
    const jobs = loadLocalCronJobs();
    const filtered = jobs.filter((j) => j.agentId !== request.params.id);
    if (filtered.length !== jobs.length) {
      saveLocalCronJobs(filtered);
    }

    return { success: true };
  });

  // GET /api/agents/:id/skills — returns skills from the agent's .claude/skills/ directory
  fastify.get<{ Params: { id: string } }>('/api/agents/:id/skills', async (request) => {
    const agent = agentStore.getAgentById(request.params.id);
    if (!agent) throw new NotFoundError('Agent', request.params.id);

    // Load skills from the SDK workspace (.claude/skills/) — the real installed skills
    const sdkSkills = listSdkSkills(request.params.id);

    // Parse SKILL.md frontmatter for name/description
    const matter = await import('gray-matter');
    const skills = sdkSkills.map((s) => {
      let name = s.id;
      let description = '';
      if (s.content) {
        try {
          const parsed = matter.default(s.content);
          const data = parsed.data as Record<string, unknown>;
          if (typeof data.name === 'string') name = data.name;
          if (typeof data.description === 'string') description = data.description;
        } catch {
          // ignore parse errors
        }
      }
      return {
        id: s.id,
        name,
        icon: 'sparkles',
        description,
        category: 'installed',
        enabled: true,
        tokenCostHint: '',
      };
    });

    return { skills };
  });

  // GET /api/agents/:id/tools — list available tools for an agent
  // Tools are now managed locally; returns an empty list (SDK manages tools internally)
  fastify.get<{ Params: { id: string } }>('/api/agents/:id/tools', async (request) => {
    const agent = agentStore.getAgentById(request.params.id);
    if (!agent) throw new NotFoundError('Agent', request.params.id);
    return { tools: [] };
  });

  // GET /api/agents/:id/workspace-path — return the agent's workspace root path
  fastify.get<{ Params: { id: string } }>('/api/agents/:id/workspace-path', async (request) => {
    const agent = agentStore.getAgentById(request.params.id);
    if (!agent) throw new NotFoundError('Agent', request.params.id);
    return { path: sdkWorkspacePath(request.params.id) };
  });

  // POST /api/agents/sync — manual re-sync (no longer uses gateway)
  fastify.post('/api/agents/sync', async () => {
    const agents = agentStore.getAllAgents();
    syncAgentsRegistry(agents);
    return { synced: true, agentCount: agents.length };
  });

  // --- Per-agent personality files (read/write from disk workspace) ---

  const AGENT_FILE_NAMES = [
    'IDENTITY.md',
    'SOUL.md',
    'USER.md',
    'TOOLS.md',
    'BOOTSTRAP.md',
    'HEARTBEAT.md',
    'MEMORY.md',
  ];

  // GET /api/agents/:id/files — list all personality files from SDK workspace (single source of truth)
  fastify.get<{ Params: { id: string } }>('/api/agents/:id/files', async (request) => {
    const agent = agentStore.getAgentById(request.params.id);
    if (!agent) throw new NotFoundError('Agent', request.params.id);

    // Ensure SDK workspace exists (creates files if missing)
    ensureSdkWorkspace(request.params.id);

    const wsDir = sdkWorkspacePath(request.params.id);
    const files = AGENT_FILE_NAMES.map((name) => {
      const filepath = join(wsDir, name);
      const fileExists = existsSync(filepath);
      let content = '';
      if (fileExists) {
        try {
          content = readFileSync(filepath, 'utf-8');
        } catch {
          // Unreadable
        }
      }
      return { name, content, exists: fileExists, hash: content ? computeFileHash(content) : '' };
    });

    return { files };
  });

  // PUT /api/agents/:id/files/:name — write a single personality file to disk
  fastify.put<{ Params: { id: string; name: string }; Body: { content: string; hash?: string } }>(
    '/api/agents/:id/files/:name',
    async (request, reply) => {
      const { id, name } = request.params;
      const body = request.body as { content: string; hash?: string };
      const { content } = body;

      const agent = agentStore.getAgentById(id);
      if (!agent) throw new NotFoundError('Agent', id);

      if (!AGENT_FILE_NAMES.includes(name)) {
        throw new ValidationError(`Invalid file name: ${name}. Must be one of: ${AGENT_FILE_NAMES.join(', ')}`);
      }

      // Write directly to the SDK workspace (single source of truth)
      const wsDir = sdkWorkspacePath(id);
      mkdirSync(wsDir, { recursive: true });
      const filepath = join(wsDir, name);

      // Hash-based optimistic concurrency: reject if file changed since client last read
      if (body.hash && existsSync(filepath)) {
        const current = readFileSync(filepath, 'utf-8');
        const currentHash = computeFileHash(current);
        if (body.hash !== currentHash) {
          return reply.status(409).send({
            error: 'File changed since last read',
            code: 'CONFLICT',
            currentHash,
          });
        }
      }

      writeFileSync(filepath, content, 'utf-8');

      // Sync identity fields back to agent store when IDENTITY.md is updated
      if (name === 'IDENTITY.md') {
        syncIdentityToAgent(id);
      }

      return { name, content, updated: true, hash: computeFileHash(content) };
    }
  );

  // --- Per-agent memory logs (timestamped files in memory/ subdirectory) ---

  // GET /api/agents/:id/memory-logs — list all .md files in memory/ dir
  fastify.get<{ Params: { id: string } }>('/api/agents/:id/memory-logs', async (request) => {
    const agent = agentStore.getAgentById(request.params.id);
    if (!agent) throw new NotFoundError('Agent', request.params.id);

    const memDir = join(sdkWorkspacePath(request.params.id), 'memory');
    if (!existsSync(memDir)) {
      return { logs: [] };
    }

    try {
      const entries = readdirSync(memDir)
        .filter((f) => f.endsWith('.md'))
        .map((f) => {
          const filepath = join(memDir, f);
          try {
            const stat = statSync(filepath);
            return { name: f, size: stat.size, modifiedAt: stat.mtime.toISOString() };
          } catch {
            return { name: f, size: 0, modifiedAt: '' };
          }
        })
        .sort((a, b) => b.name.localeCompare(a.name)); // newest first

      return { logs: entries };
    } catch {
      return { logs: [] };
    }
  });

  // GET /api/agents/:id/memory-logs/:file — read a specific memory log file
  fastify.get<{ Params: { id: string; file: string } }>(
    '/api/agents/:id/memory-logs/:file',
    async (request) => {
      const { id, file } = request.params;

      const agent = agentStore.getAgentById(id);
      if (!agent) throw new NotFoundError('Agent', id);

      if (!file.endsWith('.md')) {
        throw new ValidationError('File must be a .md file');
      }

      // Prevent directory traversal
      if (file.includes('/') || file.includes('\\') || file.includes('..')) {
        throw new ValidationError('Invalid file name');
      }

      const filepath = join(sdkWorkspacePath(id), 'memory', file);
      if (!existsSync(filepath)) {
        throw new NotFoundError('MemoryLog', file);
      }

      const content = readFileSync(filepath, 'utf-8');
      return { name: file, content };
    }
  );
}
