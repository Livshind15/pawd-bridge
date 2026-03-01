import { FastifyInstance } from 'fastify';
import { logger } from '../../utils/logger.js';
import { listSkills, addSkill, removeSkill } from '../../sdk/index.js';

export interface RegistrySkill {
  slug: string;
  name: string;
  description: string;
  version: string;
  author?: string;
  category?: string;
  readme?: string;
  requirements?: string[];
  installed?: boolean;
  downloadCount?: number;
  updatedAt?: string;
}

export function skillRegistryRoutes(fastify: FastifyInstance): void {
  // GET /api/skill-registry/search?q=...&category=...
  // In SDK mode, skill registry search is not available (no remote registry).
  // Returns locally installed skills filtered by query.
  fastify.get<{
    Querystring: { q?: string; category?: string; limit?: string; offset?: string; agentId?: string };
  }>('/api/skill-registry/search', async (request) => {
    const { q, agentId } = request.query;

    if (!agentId) {
      return { skills: [], total: 0, message: 'Provide agentId to list workspace skills' };
    }

    const skills = listSkills(agentId);
    let results = skills.map((s) => ({
      slug: s.id,
      name: s.id,
      description: s.content.slice(0, 200),
      version: '1.0.0',
      installed: true,
    }));

    // Filter by query if provided
    if (q) {
      const lower = q.toLowerCase();
      results = results.filter(
        (s) =>
          s.slug.toLowerCase().includes(lower) ||
          s.name.toLowerCase().includes(lower) ||
          s.description.toLowerCase().includes(lower)
      );
    }

    return { skills: results, total: results.length };
  });

  // GET /api/skill-registry/:slug — get skill detail
  fastify.get<{ Params: { slug: string }; Querystring: { agentId?: string } }>(
    '/api/skill-registry/:slug',
    async (request) => {
      const { slug } = request.params;
      const agentId = (request.query as { agentId?: string }).agentId;

      if (!/^[a-zA-Z0-9_-]+$/.test(slug)) {
        return { skill: null, error: 'Invalid skill slug' };
      }

      if (!agentId) {
        return { skill: null, error: 'Provide agentId to look up workspace skills' };
      }

      const skills = listSkills(agentId);
      const found = skills.find((s) => s.id === slug);
      if (!found) {
        return { skill: null };
      }

      return {
        skill: {
          slug: found.id,
          name: found.id,
          description: found.content,
          version: '1.0.0',
          installed: true,
        },
      };
    }
  );

  // POST /api/skill-registry/:slug/install — install skill (add to workspace)
  fastify.post<{ Params: { slug: string }; Body: { agentId?: string; content?: string } }>(
    '/api/skill-registry/:slug/install',
    async (request) => {
      const { slug } = request.params;
      const body = request.body as { agentId?: string; content?: string };

      if (!/^[a-zA-Z0-9_-]+$/.test(slug)) {
        return { success: false, error: 'Invalid skill slug' };
      }

      if (!body.agentId) {
        return { success: false, error: 'agentId is required to install a skill' };
      }

      const content = body.content || `# ${slug}\n\nSkill installed from registry.\n`;
      addSkill(body.agentId, slug, content);
      logger.info({ slug, agentId: body.agentId }, '[skill-registry] Skill installed');
      return { success: true };
    }
  );

  // DELETE /api/skill-registry/:slug — uninstall a skill
  fastify.delete<{ Params: { slug: string }; Querystring: { agentId?: string } }>(
    '/api/skill-registry/:slug',
    async (request) => {
      const { slug } = request.params;
      const agentId = (request.query as { agentId?: string }).agentId;

      if (!/^[a-zA-Z0-9_-]+$/.test(slug)) {
        return { success: false, error: 'Invalid skill slug' };
      }

      if (!agentId) {
        return { success: false, error: 'agentId is required to uninstall a skill' };
      }

      const removed = removeSkill(agentId, slug);
      logger.info({ slug, agentId, removed }, '[skill-registry] Skill uninstalled');
      return { success: removed };
    }
  );
}
