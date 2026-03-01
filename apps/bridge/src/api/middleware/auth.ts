import { FastifyRequest, FastifyReply } from 'fastify';
import { verifyDeviceToken, hasDevices } from '../../auth/index.js';

export interface AuthUser {
  id: string;
  email?: string;
  role?: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

/**
 * Device-token auth middleware.
 *
 * - Bearer token present  -> validate via verifyDeviceToken
 * - No token, no devices  -> bootstrapping mode (first-run)
 * - No token, has devices  -> reject
 */
export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const authHeader = request.headers.authorization;
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : undefined;

  if (token) {
    const result = verifyDeviceToken(token);
    if (result) {
      request.user = { id: result.deviceId, role: 'owner' };
      return;
    }
    reply.code(401).send({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Invalid or expired device token',
      },
    });
    return;
  }

  // No token provided
  if (!hasDevices()) {
    // Bootstrapping mode — no devices registered yet, allow anonymous access
    request.user = { id: 'local', role: 'owner' };
    return;
  }

  reply.code(401).send({
    error: {
      code: 'UNAUTHORIZED',
      message: 'Device token required',
    },
  });
}
