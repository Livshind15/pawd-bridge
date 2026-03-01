import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { FastifyInstance } from 'fastify';
import matter from 'gray-matter';
import { config } from '../../config.js';
import { getAllAgents } from '../../store/entities/agents.js';
import { agentWorkspacePath } from '../../sdk/workspace.js';

export interface SkillMeta {
  ownerId?: string;
  slug?: string;
  version?: string;
  publishedAt?: number;
}

export interface SkillIndexEntry {
  id: string;
  name: string;
  description: string;
  version?: string;
  whenToUse?: string[];
  commands?: string[];
}

export interface SkillExplanation {
  id: string;
  name: string;
  description: string;
  version?: string;
  metadata?: SkillMeta;
  path: string;
  whenToUse?: string[];
  commands?: string[];
  builtIn?: boolean;
  /** Agent ID that owns this skill (undefined for workspace-level skills) */
  agentId?: string;
  /** Agent name that owns this skill */
  agentName?: string;
}

// Known skills that ship with Claude SDK by default
const BUILT_IN_SLUGS = new Set(['clawdhub', 'find-skills', 'github', 'pawd-tasks']);

// Known built-in Pawd skills installed per-agent
const PAWD_BUILT_IN_SLUGS = new Set([
  'pawd-tasks', 'pawd-cron', 'pawd-memory', 'pawd-agent-builder', 'pawd-self-improve', 'pawd-webhooks',
]);

function parseSkillFrontmatter(content: string): { name?: string; description?: string } {
  try {
    const parsed = matter(content);
    const data = parsed.data as Record<string, unknown>;
    return {
      name: typeof data.name === 'string' ? data.name : undefined,
      description: typeof data.description === 'string' ? data.description : undefined,
    };
  } catch {
    return {};
  }
}

function parseMetaJson(content: string): SkillMeta | null {
  try {
    return JSON.parse(content) as SkillMeta;
  } catch {
    return null;
  }
}

function loadSkillsIndex(workspaceDir: string): Promise<Record<string, SkillIndexEntry>> {
  const indexPath = join(workspaceDir, 'skills-index.json');
  return readFile(indexPath, 'utf-8')
    .then((content) => {
      const data = JSON.parse(content) as { skills?: SkillIndexEntry[] };
      const entries = data.skills ?? [];
      const map: Record<string, SkillIndexEntry> = {};
      for (const e of entries) {
        map[e.id] = e;
      }
      return map;
    })
    .catch(() => ({}));
}

async function loadSkillsFromDir(skillsDir: string): Promise<SkillExplanation[]> {
  const results: SkillExplanation[] = [];

  let entries: string[];
  try {
    entries = await readdir(skillsDir, { withFileTypes: true }).then((e) =>
      e.filter((d) => d.isDirectory()).map((d) => d.name)
    );
  } catch {
    return [];
  }

  for (const dir of entries) {
    const skillPath = join(skillsDir, dir);
    const skillMdPath = join(skillPath, 'SKILL.md');
    const metaPath = join(skillPath, '_meta.json');

    let name = dir;
    let description = '';
    let meta: SkillMeta | null = null;

    try {
      const skillMd = await readFile(skillMdPath, 'utf-8');
      const frontmatter = parseSkillFrontmatter(skillMd);
      name = frontmatter.name ?? dir;
      description = frontmatter.description ?? '';
    } catch {
      // SKILL.md missing or unreadable
    }

    try {
      const metaRaw = await readFile(metaPath, 'utf-8');
      meta = parseMetaJson(metaRaw);
    } catch {
      // _meta.json missing or unreadable
    }

    results.push({
      id: dir,
      name,
      description,
      version: meta?.version,
      metadata: meta ?? undefined,
      path: skillPath,
    });
  }

  return results.sort((a, b) => a.name.localeCompare(b.name));
}

export function skillsRoutes(fastify: FastifyInstance): void {
  // GET /api/skills - List all skills from all agents' .claude/skills/ directories
  fastify.get('/api/skills', async () => {
    const agents = getAllAgents();
    const index = await loadSkillsIndex(config.agentWorkspacesDir);

    // Load skills from each agent's SDK workspace (.claude/skills/)
    const allSkills: SkillExplanation[] = [];
    const seen = new Set<string>(); // deduplicate by skill id

    for (const agent of agents) {
      const wsDir = agentWorkspacePath(agent.id);
      const agentSkillsDir = join(wsDir, '.claude', 'skills');
      const skills = await loadSkillsFromDir(agentSkillsDir);

      for (const s of skills) {
        const entry = index[s.id];
        const key = `${agent.id}:${s.id}`;
        if (seen.has(key)) continue;
        seen.add(key);

        allSkills.push({
          ...s,
          builtIn: BUILT_IN_SLUGS.has(s.name) || PAWD_BUILT_IN_SLUGS.has(s.id),
          whenToUse: entry?.whenToUse,
          commands: entry?.commands,
          description: s.description || entry?.description || '',
          agentId: agent.id,
          agentName: agent.name,
        });
      }
    }

    // Also load workspace-level skills (from config.agentWorkspacesDir/skills/)
    const workspaceSkills = await loadSkillsFromDir(join(config.agentWorkspacesDir, 'skills'));
    for (const s of workspaceSkills) {
      if (seen.has(`workspace:${s.id}`)) continue;
      seen.add(`workspace:${s.id}`);

      const entry = index[s.id];
      allSkills.push({
        ...s,
        builtIn: BUILT_IN_SLUGS.has(s.name),
        whenToUse: entry?.whenToUse,
        commands: entry?.commands,
        description: s.description || entry?.description || '',
      });
    }

    return { skills: allSkills.sort((a, b) => a.name.localeCompare(b.name)) };
  });
}
