import { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { logger } from '../../utils/logger.js';

export class BridgeError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'BridgeError';
  }
}

export class NotFoundError extends BridgeError {
  constructor(entity: string, id: string) {
    super(404, `${entity} not found: ${id}`, 'NOT_FOUND');
  }
}

export class GatewayUnavailableError extends BridgeError {
  constructor() {
    super(503, 'Gateway connection unavailable', 'GATEWAY_UNAVAILABLE');
  }
}

export class GatewayTimeoutError extends BridgeError {
  constructor(method: string) {
    super(504, `Gateway request timed out: ${method}`, 'GATEWAY_TIMEOUT');
  }
}

export class ValidationError extends BridgeError {
  constructor(message: string, details?: unknown) {
    super(400, message, 'VALIDATION_ERROR', details);
  }
}

export function errorHandler(
  error: FastifyError | BridgeError,
  request: FastifyRequest,
  reply: FastifyReply
): void {
  if (error instanceof BridgeError) {
    const body: Record<string, unknown> = {
      code: error.code,
      message: error.message,
    };
    if (error.details) {
      body.details = error.details;
    }
    reply.code(error.statusCode).send({ error: body });
    return;
  }

  logger.error({ err: error, url: request.url }, 'Unhandled error');

  const statusCode = 'statusCode' in error ? (error.statusCode ?? 500) : 500;
  reply.code(statusCode).send({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    },
  });
}
