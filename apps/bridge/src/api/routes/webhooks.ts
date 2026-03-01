import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { generateId } from '../../utils/id.js';
import { logger } from '../../utils/logger.js';
import { eventBus } from '../../events/bus.js';
import { activityFeedStore } from '../../store/entities/activity-feed.js';
import { runAgent } from '../../sdk/index.js';
import {
  getAllWebhooks,
  getWebhookById,
  createWebhook,
  updateWebhook,
  deleteWebhook,
  recordFire,
  type WebhookCreate,
  type WebhookUpdate,
} from '../../store/entities/webhooks.js';
import * as agentStore from '../../store/entities/agents.js';
import { NotFoundError, ValidationError } from '../middleware/errors.js';

// ── Template rendering ────────────────────────────────────────────────────────

/**
 * Replace {{field}} and {{nested.field}} placeholders with values from payload.
 * Unknown placeholders are left as-is.
 */
function renderTemplate(template: string, payload: Record<string, unknown>): string {
  return template.replace(/\{\{([\w.]+)\}\}/g, (match, path: string) => {
    const parts = path.split('.');
    let val: unknown = payload;
    for (const part of parts) {
      if (val !== null && typeof val === 'object') {
        val = (val as Record<string, unknown>)[part];
      } else {
        val = undefined;
        break;
      }
    }
    return val !== undefined ? String(val) : match;
  });
}

// ── HMAC signature validation ─────────────────────────────────────────────────

/**
 * Validate X-Webhook-Signature header against the webhook secret.
 * Accepts both 'sha256=<hex>' and raw hex formats.
 */
function validateSignature(secret: string, rawBody: string, header: string): boolean {
  const expected = createHmac('sha256', secret).update(rawBody, 'utf-8').digest('hex');
  const received = header.replace(/^sha256=/, '');
  try {
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(received, 'hex');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

export function webhookRoutes(fastify: FastifyInstance): void {
  // ── PUBLIC: POST /api/webhooks/trigger/:webhookId ─────────────────────────
  // Inbound webhook — receives external payloads and triggers the configured agent.
  // No auth required; optional HMAC signature validation via X-Webhook-Signature.
  fastify.post<{
    Params: { webhookId: string };
    Body: Record<string, unknown>;
  }>('/api/webhooks/trigger/:webhookId', async (request, reply) => {
    const { webhookId } = request.params;
    const webhook = getWebhookById(webhookId);

    if (!webhook) {
      return reply.status(404).send({ error: 'Webhook not found' });
    }
    if (!webhook.enabled) {
      return reply.status(403).send({ error: 'Webhook is disabled' });
    }

    // Validate HMAC signature when secret is configured
    if (webhook.secret) {
      const sigHeader = (request.headers['x-webhook-signature'] as string) ?? '';
      const rawBody = JSON.stringify(request.body ?? {});
      if (!sigHeader || !validateSignature(webhook.secret, rawBody, sigHeader)) {
        logger.warn({ webhookId }, '[webhook] Invalid signature');
        return reply.status(401).send({ error: 'Invalid webhook signature' });
      }
    }

    // Build conversation ID based on sessionTarget
    const conversationId =
      webhook.sessionTarget === 'heartbeat'
        ? `heartbeat-${webhook.agentId}`
        : webhook.sessionTarget === 'new'
          ? generateId('conv')
          : webhook.sessionTarget;

    // Render the prompt template with the inbound payload
    const payload = (request.body as Record<string, unknown>) ?? {};
    const prompt = renderTemplate(webhook.promptTemplate, payload);

    logger.info({ webhookId, agentId: webhook.agentId, conversationId }, '[webhook] Triggering agent');

    // Fire agent (non-blocking)
    runAgent(webhook.agentId, conversationId, prompt).catch((err) => {
      logger.error({ webhookId, err }, '[webhook] Agent run failed');
    });

    // Record the fire
    recordFire(webhookId);

    // Broadcast event
    eventBus.broadcast({
      type: 'webhook.triggered',
      payload: { webhookId, agentId: webhook.agentId, conversationId, name: webhook.name },
    });

    activityFeedStore.addEvent({
      type: 'webhook.triggered',
      source: 'webhook',
      title: `Webhook: ${webhook.name}`,
      agentId: webhook.agentId,
      status: 'completed',
      description: `Triggered agent ${webhook.agentId}`,
      metadata: { webhookId, conversationId },
    });

    return reply.status(202).send({ ok: true, webhookId, agentId: webhook.agentId, conversationId });
  });

  // ── GET /api/webhooks ─────────────────────────────────────────────────────
  fastify.get('/api/webhooks', async () => {
    const webhooks = getAllWebhooks();
    return { webhooks };
  });

  // ── POST /api/webhooks ────────────────────────────────────────────────────
  fastify.post<{ Body: WebhookCreate }>('/api/webhooks', async (request) => {
    const body = request.body as WebhookCreate;
    if (!body.name) throw new ValidationError('name is required');
    if (!body.agentId) throw new ValidationError('agentId is required');
    if (!body.promptTemplate) throw new ValidationError('promptTemplate is required');
    if (!agentStore.getAgentById(body.agentId)) {
      throw new ValidationError(`Agent '${body.agentId}' does not exist`);
    }
    const webhook = createWebhook({
      name: body.name,
      agentId: body.agentId,
      sessionTarget: body.sessionTarget ?? 'heartbeat',
      secret: body.secret,
      promptTemplate: body.promptTemplate,
      enabled: body.enabled ?? true,
    });
    return { webhook };
  });

  // ── GET /api/webhooks/:id ─────────────────────────────────────────────────
  fastify.get<{ Params: { id: string } }>('/api/webhooks/:id', async (request) => {
    const webhook = getWebhookById(request.params.id);
    if (!webhook) throw new NotFoundError('Webhook', request.params.id);
    return { webhook };
  });

  // ── PUT /api/webhooks/:id ─────────────────────────────────────────────────
  fastify.put<{ Params: { id: string }; Body: WebhookUpdate }>(
    '/api/webhooks/:id',
    async (request) => {
      if (!getWebhookById(request.params.id)) throw new NotFoundError('Webhook', request.params.id);
      const patch = request.body as WebhookUpdate;
      if (patch.agentId && !agentStore.getAgentById(patch.agentId)) {
        throw new ValidationError(`Agent '${patch.agentId}' does not exist`);
      }
      const updated = updateWebhook(request.params.id, patch);
      return { webhook: updated };
    },
  );

  // ── DELETE /api/webhooks/:id ──────────────────────────────────────────────
  fastify.delete<{ Params: { id: string } }>('/api/webhooks/:id', async (request) => {
    if (!deleteWebhook(request.params.id)) throw new NotFoundError('Webhook', request.params.id);
    return { ok: true };
  });

  // ── POST /api/webhooks/:id/test ───────────────────────────────────────────
  // Dry-run: renders the prompt template without triggering any agent.
  fastify.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/api/webhooks/:id/test',
    async (request) => {
      const webhook = getWebhookById(request.params.id);
      if (!webhook) throw new NotFoundError('Webhook', request.params.id);
      const payload = (request.body as Record<string, unknown>) ?? {};
      const rendered = renderTemplate(webhook.promptTemplate, payload);
      return {
        ok: true,
        renderedPrompt: rendered,
        agentId: webhook.agentId,
        sessionTarget: webhook.sessionTarget,
        note: 'Dry-run preview — no agent was triggered.',
      };
    },
  );
}
