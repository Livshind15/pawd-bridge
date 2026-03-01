import { FastifyInstance } from 'fastify';
import { eventBus, type SequencedEvent } from '../../events/bus.js';
import { logger } from '../../utils/logger.js';
import { verifyDeviceToken, hasDevices } from '../../auth/index.js';

/** Check if an event passes the conversation-scoped filter. */
function passesFilter(event: SequencedEvent, filterConversationId: string | null): boolean {
  if (!filterConversationId || !event.payload) return true;
  const eventConvId = (event.payload.conversationId as string)
    || (event.payload.sessionId as string)
    || (event.payload.sessionKey as string);
  if (eventConvId && eventConvId.toLowerCase() !== filterConversationId.toLowerCase()) {
    return false;
  }
  return true;
}

/** Write a single SSE event frame including the seq number. */
function writeEvent(raw: NodeJS.WritableStream, event: SequencedEvent): void {
  raw.write(`event: ${event.type}\n`);
  raw.write(`data: ${JSON.stringify({ ...event.payload, seq: event.seq })}\n\n`);
}

export function eventRoutes(fastify: FastifyInstance): void {
  // GET /api/events - SSE stream
  // Optional ?conversationId= to scope events to a specific conversation
  // Optional ?lastSeq= to replay missed events on reconnect
  fastify.get<{ Querystring: { conversationId?: string; access_token?: string; lastSeq?: string } }>(
    '/api/events',
    async (request, reply) => {
      const query = request.query as { conversationId?: string; access_token?: string; lastSeq?: string };

      const token = query.access_token;

      if (token) {
        const result = verifyDeviceToken(token);
        if (!result) {
          return reply.status(401).send({ error: 'Invalid or expired device token' });
        }
        (request as any).user = { id: result.deviceId, role: 'owner' };
      } else if (hasDevices()) {
        return reply.status(401).send({ error: 'Authentication required' });
      } else {
        logger.info('[events] No devices registered, allowing unauthenticated SSE connection (bootstrapping)');
      }

      const filterConversationId = query.conversationId || null;
      const lastSeq = query.lastSeq ? parseInt(query.lastSeq, 10) : 0;
      logger.info({ filterConversationId, lastSeq }, '[events] SSE client connected');

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      // Send initial connected event with current seq for reference
      reply.raw.write(`event: connected\ndata: ${JSON.stringify({ ts: Date.now(), seq: eventBus.currentSeq })}\n\n`);

      // Replay missed events if the client provided lastSeq
      if (lastSeq > 0) {
        const missed = eventBus.replay(lastSeq);
        let replayed = 0;
        for (const event of missed) {
          if (passesFilter(event, filterConversationId)) {
            writeEvent(reply.raw, event);
            replayed++;
          }
        }
        if (replayed > 0) {
          logger.info({ replayed, lastSeq }, '[events] SSE: replayed missed events');
        }
      }

      const onEvent = (event: SequencedEvent) => {
        if (!passesFilter(event, filterConversationId)) return;

        logger.info({ type: event.type, seq: event.seq, filterConversationId }, '[events] SSE: writing event to client');
        writeEvent(reply.raw, event);
      };

      // Heartbeat every 30s
      const heartbeat = setInterval(() => {
        reply.raw.write(`: heartbeat\n\n`);
      }, 30000);

      eventBus.on('bridge-event', onEvent);

      request.raw.on('close', () => {
        eventBus.off('bridge-event', onEvent);
        clearInterval(heartbeat);
      });
    }
  );
}
