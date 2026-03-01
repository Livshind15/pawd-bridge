import { FastifyInstance } from 'fastify';
import * as conversationStore from '../../store/entities/conversations.js';
import * as agentStore from '../../store/entities/agents.js';
import { NotFoundError, ValidationError } from '../middleware/errors.js';
import { generateId } from '../../utils/id.js';
import { eventBus } from '../../events/bus.js';
import { logger } from '../../utils/logger.js';
import { runAgent, abortAgent, isAgentRunning, deleteSession } from '../../sdk/index.js';

/**
 * Parse @mentions from message text and resolve to agent IDs.
 * Returns matched agent IDs and the original text (mentions kept for context).
 */
function parseAtMentions(text: string, eligibleAgentIds: string[]): string[] {
  const mentionPattern = /@(\w[\w-]*)/g;
  const mentionedNames: string[] = [];
  let match;
  while ((match = mentionPattern.exec(text)) !== null) {
    mentionedNames.push(match[1].toLowerCase());
  }
  if (mentionedNames.length === 0) return [];

  const allAgents = agentStore.getAllAgents();
  const eligibleSet = new Set(eligibleAgentIds);
  const mentionedIds: string[] = [];

  for (const name of mentionedNames) {
    const found = allAgents.find(
      (a) =>
        eligibleSet.has(a.id) &&
        (a.id.toLowerCase() === name || a.name.toLowerCase() === name)
    );
    if (found && !mentionedIds.includes(found.id)) {
      mentionedIds.push(found.id);
    }
  }

  return mentionedIds;
}

export function chatRoutes(fastify: FastifyInstance): void {
  // GET /api/conversations?agentId=xxx — list conversations, optionally filtered by agent
  fastify.get<{ Querystring: { agentId?: string } }>('/api/conversations', async (request) => {
    let conversations = conversationStore.getAllConversations();
    const { agentId } = request.query as { agentId?: string };
    if (agentId) {
      conversations = conversations.filter(
        (c) => c.agentId === agentId || (c.agentIds && c.agentIds.includes(agentId))
      );
    }
    return { conversations };
  });

  // PATCH /api/conversations/:id — rename a session
  fastify.patch<{ Params: { id: string }; Body: { title?: string } }>(
    '/api/conversations/:id',
    async (request) => {
      const conversation = conversationStore.getConversation(request.params.id);
      if (!conversation) throw new NotFoundError('Conversation', request.params.id);
      const { title } = request.body as { title?: string };
      if (title !== undefined) {
        conversation.meta.title = title;
        conversation.meta.updatedAt = new Date().toISOString();
        conversationStore.createConversation(conversation.meta); // re-writes meta.md
      }
      return { conversation: conversation.meta };
    }
  );

  // GET /api/conversations/:id
  fastify.get<{ Params: { id: string } }>('/api/conversations/:id', async (request) => {
    const conversation = conversationStore.getConversation(request.params.id);
    if (!conversation) throw new NotFoundError('Conversation', request.params.id);
    return conversation;
  });

  // POST /api/conversations
  fastify.post<{
    Body: { title?: string; agentId?: string; agentIds?: string[]; mode?: string };
  }>('/api/conversations', async (request) => {
    const body = request.body as { title?: string; agentId?: string; agentIds?: string[]; mode?: string };

    const mode = (body.mode as 'single' | 'broadcast' | 'multi') || 'single';
    let agentIds: string[] = [];

    if (mode === 'single') {
      if (!body.agentId) throw new ValidationError('agentId is required for single-agent conversations');
      agentIds = [body.agentId];
    } else {
      agentIds = body.agentIds || [];
      if (agentIds.length === 0 && mode === 'broadcast') {
        agentIds = agentStore.getAllAgents().map((a) => a.id);
      }
      if (agentIds.length === 0) {
        throw new ValidationError('At least one agent is required');
      }
    }

    const primaryAgentId = body.agentId || agentIds[0];

    logger.info({ primaryAgentId, mode, agentCount: agentIds.length }, '[chat] POST /conversations — creating new conversation');

    const id = generateId('conv').toLowerCase();
    const meta: conversationStore.ConversationMeta = {
      id,
      title: body.title || (mode === 'broadcast' ? 'All Agents' : 'New Conversation'),
      agentId: primaryAgentId,
      agentIds: mode !== 'single' ? agentIds : undefined,
      mode: mode !== 'single' ? mode : undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messageCount: 0,
    };

    const created = conversationStore.createConversation(meta);
    logger.info({ conversationId: id, mode }, '[chat] Conversation created');
    return { conversation: created };
  });

  // POST /api/conversations/:id/messages
  // Fire-and-forget: persists user message, starts SDK agent run, returns immediately.
  // The assistant response streams via SSE events and is persisted by the chat event listener.
  fastify.post<{
    Params: { id: string };
    Body: { content: string; attachments?: { type: string; media_type: string; data: string }[] };
  }>('/api/conversations/:id/messages', async (request) => {
    const { id } = request.params;
    const body = request.body as { content: string; attachments?: { type: string; media_type: string; data: string }[] };
    logger.info({ conversationId: id, content: body.content?.slice(0, 50), hasAttachments: !!body.attachments?.length }, '[chat] POST /messages received');
    if (!body.content && !body.attachments?.length) throw new ValidationError('Message content or attachments required');

    const conversation = conversationStore.getConversation(id);
    if (!conversation) {
      logger.error({ conversationId: id }, '[chat] Conversation not found');
      throw new NotFoundError('Conversation', id);
    }

    const meta = conversation.meta;
    const mode = meta.mode || 'single';
    const allAgentIds = meta.agentIds || [meta.agentId];

    logger.info({ conversationId: id, mode, agentCount: allAgentIds.length }, '[chat] Found conversation');

    // Determine target agents
    let targetAgentIds: string[];
    if (mode === 'single') {
      targetAgentIds = [meta.agentId];
    } else {
      const mentionedIds = parseAtMentions(body.content, allAgentIds);
      targetAgentIds = mentionedIds.length > 0 ? mentionedIds : allAgentIds;
    }

    // Create and persist user message
    const userMessage: conversationStore.ChatMessage = {
      id: generateId('msg'),
      role: 'user',
      content: body.content || '',
      timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
      ...(body.attachments?.length ? { attachments: body.attachments.map(a => ({ type: 'image' as const, media_type: a.media_type, data: a.data })) } : {}),
    };

    conversationStore.appendMessage(id, userMessage);
    logger.info({ conversationId: id, msgId: userMessage.id, targetAgents: targetAgentIds }, '[chat] Persisted user message');

    // Fan-out to each target agent via SDK runAgent (fire-and-forget)
    for (const targetAgentId of targetAgentIds) {
      logger.info({ conversationId: id, agentId: targetAgentId }, '[chat] Starting SDK runAgent');

      // Convert image attachments to SDK MessageAttachment format
      const sdkAttachments = body.attachments?.map(a => ({
        data: a.data,
        mediaType: a.media_type,
      }));

      // Fire-and-forget: runAgent broadcasts events via eventBus automatically
      runAgent(targetAgentId, id, body.content || '', sdkAttachments).catch((err) => {
        logger.error({ conversationId: id, agentId: targetAgentId, err: err instanceof Error ? err.message : err }, '[chat] SDK runAgent FAILED');
        eventBus.broadcast({
          type: 'chat.error',
          payload: {
            conversationId: id,
            agentId: targetAgentId,
            error: err instanceof Error ? err.message : 'SDK runAgent failed',
          },
        });
      });
    }

    logger.info({ conversationId: id }, '[chat] Returning immediately with streaming: true');
    return { userMessage, streaming: true, targetAgentIds };
  });

  // POST /api/conversations/:id/abort — stop an in-progress generation
  fastify.post<{ Params: { id: string } }>('/api/conversations/:id/abort', async (request) => {
    const { id } = request.params;

    const conversation = conversationStore.getConversation(id);
    if (!conversation) throw new NotFoundError('Conversation', id);

    const meta = conversation.meta;
    const allAgentIds = meta.agentIds || [meta.agentId];

    // Abort all active agent runs for this conversation
    for (const aId of allAgentIds) {
      abortAgent(aId, id);
    }

    return { success: true };
  });

  // GET /api/conversations/:id/messages
  fastify.get<{
    Params: { id: string };
    Querystring: { limit?: string; offset?: string };
  }>('/api/conversations/:id/messages', async (request) => {
    const conversation = conversationStore.getConversation(request.params.id);
    if (!conversation) throw new NotFoundError('Conversation', request.params.id);

    const limit = request.query.limit ? parseInt(request.query.limit, 10) : undefined;
    const offset = request.query.offset ? parseInt(request.query.offset, 10) : undefined;
    const result = conversationStore.getMessagesPaginated(request.params.id, limit, offset);

    return { messages: result.messages, totalCount: result.totalCount };
  });

  // GET /api/conversations/:id/gateway-history — No longer available (was gateway-specific)
  fastify.get<{
    Params: { id: string };
    Querystring: { agentId?: string };
  }>('/api/conversations/:id/gateway-history', async (_request, reply) => {
    return reply.status(501).send({ error: 'Gateway history is no longer available. Use /api/conversations/:id/messages instead.' });
  });

  // DELETE /api/conversations/:id
  fastify.delete<{ Params: { id: string } }>('/api/conversations/:id', async (request) => {
    const conversation = conversationStore.getConversation(request.params.id);
    if (!conversation) throw new NotFoundError('Conversation', request.params.id);

    const meta = conversation.meta;
    const allAgentIds = meta.agentIds || [meta.agentId];
    const deleted = conversationStore.deleteConversation(request.params.id);
    if (!deleted) throw new NotFoundError('Conversation', request.params.id);

    // Delete SDK sessions for all agents in this conversation
    for (const aId of allAgentIds) {
      try {
        deleteSession(aId, request.params.id);
      } catch {
        // Best-effort session cleanup
      }
    }

    return { success: true };
  });
}
