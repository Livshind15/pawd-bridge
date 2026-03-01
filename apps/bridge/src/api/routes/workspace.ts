import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { FastifyInstance } from 'fastify';
import { config } from '../../config.js';
import { WORKSPACE_IDENTITY_FILES } from '../../store/workspace.js';
import { ValidationError, NotFoundError } from '../middleware/errors.js';

export function workspaceRoutes(fastify: FastifyInstance): void {
  // GET /api/workspace/files — List all identity files with content
  fastify.get('/api/workspace/files', async () => {
    const files = WORKSPACE_IDENTITY_FILES.map((name) => {
      const filepath = join(config.agentWorkspacesDir, name);
      const exists = existsSync(filepath);
      let content = '';
      if (exists) {
        try {
          content = readFileSync(filepath, 'utf-8');
        } catch {
          // Unreadable
        }
      }
      return { name, content, exists };
    });

    return { files };
  });

  // GET /api/workspace/files/:name — Read a single identity file
  fastify.get<{ Params: { name: string } }>('/api/workspace/files/:name', async (request) => {
    const { name } = request.params;

    if (!WORKSPACE_IDENTITY_FILES.includes(name)) {
      throw new ValidationError(`Invalid workspace file: ${name}. Allowed: ${WORKSPACE_IDENTITY_FILES.join(', ')}`);
    }

    const filepath = join(config.agentWorkspacesDir, name);
    if (!existsSync(filepath)) {
      throw new NotFoundError('WorkspaceFile', name);
    }

    const content = readFileSync(filepath, 'utf-8');
    return { name, content };
  });

  // PUT /api/workspace/files/:name — Write a single identity file
  fastify.put<{ Params: { name: string }; Body: { content: string } }>(
    '/api/workspace/files/:name',
    async (request) => {
      const { name } = request.params;
      const body = request.body as { content?: string };

      if (!WORKSPACE_IDENTITY_FILES.includes(name)) {
        throw new ValidationError(`Invalid workspace file: ${name}. Allowed: ${WORKSPACE_IDENTITY_FILES.join(', ')}`);
      }

      if (typeof body.content !== 'string') {
        throw new ValidationError('Body must include "content" as a string');
      }

      mkdirSync(config.agentWorkspacesDir, { recursive: true });
      const filepath = join(config.agentWorkspacesDir, name);
      writeFileSync(filepath, body.content, 'utf-8');

      return { name, content: body.content, updated: true };
    }
  );
}
