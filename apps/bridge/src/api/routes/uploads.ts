import { FastifyInstance } from 'fastify';
import { join } from 'path';
import { mkdirSync, writeFileSync } from 'fs';
import { config } from '../../config.js';
import * as agentStore from '../../store/entities/agents.js';
import { NotFoundError, ValidationError } from '../middleware/errors.js';
import { generateId } from '../../utils/id.js';
import { syncAgentToWorkspace } from '../../store/workspace.js';
import { logger } from '../../utils/logger.js';

const ALLOWED_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

export function uploadRoutes(fastify: FastifyInstance): void {
  const avatarsDir = join(config.dataDir, 'uploads', 'avatars');
  mkdirSync(avatarsDir, { recursive: true });

  // POST /api/agents/:id/avatar — upload an avatar image for an agent
  fastify.post<{ Params: { id: string } }>(
    '/api/agents/:id/avatar',
    async (request) => {
      logger.info({ agentId: request.params.id, contentType: request.headers['content-type'] }, '[upload] Avatar upload request');

      const agent = agentStore.getAgentById(request.params.id);
      if (!agent) throw new NotFoundError('Agent', request.params.id);

      let data;
      try {
        data = await request.file();
      } catch (err) {
        logger.error({ err }, '[upload] Failed to parse multipart file');
        throw new ValidationError('Failed to parse uploaded file');
      }
      if (!data) throw new ValidationError('No file uploaded');

      logger.info({ filename: data.filename, mimetype: data.mimetype, fieldname: data.fieldname }, '[upload] File received');

      // Validate file extension
      const originalFilename = data.filename || 'upload.png';
      const ext = (originalFilename.split('.').pop() || 'png').toLowerCase();
      if (!ALLOWED_EXTENSIONS.includes(ext)) {
        throw new ValidationError(
          `Invalid file type "${ext}". Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`
        );
      }

      // Read file buffer
      const buffer = await data.toBuffer();
      logger.info({ size: buffer.length }, '[upload] Buffer read');
      if (buffer.length > MAX_FILE_SIZE) {
        throw new ValidationError(
          `File too large (${(buffer.length / 1024 / 1024).toFixed(1)}MB). Max: 5MB`
        );
      }

      // Save to disk
      const filename = `${request.params.id}_${generateId('av')}.${ext}`;
      const filepath = join(avatarsDir, filename);
      writeFileSync(filepath, buffer);

      // Build the avatar URL (relative — will be served by @fastify/static)
      const avatarUrl = `/api/uploads/avatars/${filename}`;

      // Update agent's avatar field
      const updated = agentStore.updateAgent(request.params.id, { avatar: avatarUrl });
      if (updated) {
        syncAgentToWorkspace(updated);
      }

      logger.info({ avatarUrl }, '[upload] Avatar saved successfully');
      return { avatar: avatarUrl };
    }
  );
}
