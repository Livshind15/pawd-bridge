import { FastifyInstance } from 'fastify';
import {
  getIntegrationSchema,
  getIntegrationConfig,
  saveIntegrationConfig,
  deleteIntegrationConfig,
  isIntegrationConnected,
  maskSecret,
  computeConfigHash,
  type IntegrationConfigValues,
} from '../../store/entities/integration-configs.js';
import { NotFoundError, ValidationError } from '../middleware/errors.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function maskValues(
  values: IntegrationConfigValues,
  schema: { fields: Array<{ key: string; type: string }> }
): IntegrationConfigValues {
  const masked: IntegrationConfigValues = {};
  for (const [key, val] of Object.entries(values)) {
    const field = schema.fields.find((f) => f.key === key);
    masked[key] = field?.type === 'secret' ? maskSecret(val) : val;
  }
  return masked;
}

async function testConnection(
  id: string,
  values: IntegrationConfigValues
): Promise<{ success: boolean; message: string; latencyMs?: number }> {
  const start = Date.now();
  const timeout = 10_000;

  try {
    switch (id) {
      case 'brave_search': {
        const key = values.api_key;
        if (!key) return { success: false, message: 'API key not configured' };
        const res = await fetch('https://api.search.brave.com/res/v1/web/search?q=test&count=1', {
          headers: { 'X-Subscription-Token': key, Accept: 'application/json' },
          signal: AbortSignal.timeout(timeout),
        });
        if (!res.ok) return { success: false, message: `Brave API returned ${res.status}`, latencyMs: Date.now() - start };
        return { success: true, message: 'Connected to Brave Search API', latencyMs: Date.now() - start };
      }

      case 'github': {
        const token = values.personal_access_token;
        if (!token) return { success: false, message: 'Token not configured' };
        const res = await fetch('https://api.github.com/user', {
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
          signal: AbortSignal.timeout(timeout),
        });
        if (!res.ok) return { success: false, message: `GitHub API returned ${res.status}`, latencyMs: Date.now() - start };
        const user = (await res.json()) as { login?: string };
        return { success: true, message: `Authenticated as ${user.login ?? 'unknown'}`, latencyMs: Date.now() - start };
      }

      case 'slack': {
        const token = values.bot_token;
        if (!token) return { success: false, message: 'Bot token not configured' };
        const res = await fetch('https://slack.com/api/auth.test', {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(timeout),
        });
        const body = (await res.json()) as { ok?: boolean; team?: string; error?: string };
        if (!body.ok) return { success: false, message: body.error ?? 'Auth test failed', latencyMs: Date.now() - start };
        return { success: true, message: `Connected to ${body.team ?? 'workspace'}`, latencyMs: Date.now() - start };
      }

      case 'notion': {
        const key = values.api_key;
        if (!key) return { success: false, message: 'Integration token not configured' };
        const res = await fetch('https://api.notion.com/v1/users/me', {
          headers: { Authorization: `Bearer ${key}`, 'Notion-Version': '2022-06-28' },
          signal: AbortSignal.timeout(timeout),
        });
        if (!res.ok) return { success: false, message: `Notion API returned ${res.status}`, latencyMs: Date.now() - start };
        return { success: true, message: 'Connected to Notion', latencyMs: Date.now() - start };
      }

      case 'linear': {
        const key = values.api_key;
        if (!key) return { success: false, message: 'API key not configured' };
        const res = await fetch('https://api.linear.app/graphql', {
          method: 'POST',
          headers: { Authorization: key, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: '{ viewer { id name } }' }),
          signal: AbortSignal.timeout(timeout),
        });
        if (!res.ok) return { success: false, message: `Linear API returned ${res.status}`, latencyMs: Date.now() - start };
        return { success: true, message: 'Connected to Linear', latencyMs: Date.now() - start };
      }

      case 'stripe': {
        const key = values.secret_key;
        if (!key) return { success: false, message: 'Secret key not configured' };
        const res = await fetch('https://api.stripe.com/v1/balance', {
          headers: { Authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(timeout),
        });
        if (!res.ok) return { success: false, message: `Stripe API returned ${res.status}`, latencyMs: Date.now() - start };
        return { success: true, message: 'Connected to Stripe', latencyMs: Date.now() - start };
      }

      case 'discord': {
        const token = values.bot_token;
        if (!token) return { success: false, message: 'Bot token not configured' };
        const res = await fetch('https://discord.com/api/v10/users/@me', {
          headers: { Authorization: `Bot ${token}` },
          signal: AbortSignal.timeout(timeout),
        });
        if (!res.ok) return { success: false, message: `Discord API returned ${res.status}`, latencyMs: Date.now() - start };
        return { success: true, message: 'Connected to Discord', latencyMs: Date.now() - start };
      }

      default:
        return { success: true, message: 'Configuration saved (no connection test available for this service)' };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Connection failed';
    return { success: false, message, latencyMs: Date.now() - start };
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function integrationConfigRoutes(fastify: FastifyInstance): void {
  // GET /api/integrations/:id/config
  fastify.get<{ Params: { id: string } }>(
    '/api/integrations/:id/config',
    async (request) => {
      const { id } = request.params;
      const schema = getIntegrationSchema(id);
      if (!schema) throw new NotFoundError('Integration', id);

      const values = getIntegrationConfig(id) ?? {};
      const connected = isIntegrationConnected(id);

      return {
        schema,
        values: maskValues(values, schema),
        connected,
        hash: computeConfigHash(values),
      };
    }
  );

  // PUT /api/integrations/:id/config
  fastify.put<{ Params: { id: string }; Body: { values: IntegrationConfigValues; hash?: string } }>(
    '/api/integrations/:id/config',
    async (request, reply) => {
      const { id } = request.params;
      const schema = getIntegrationSchema(id);
      if (!schema) throw new NotFoundError('Integration', id);

      const body = request.body as { values?: IntegrationConfigValues; hash?: string };
      if (!body.values || typeof body.values !== 'object') {
        throw new ValidationError('Body must include "values" as an object');
      }

      // Merge with existing values — don't overwrite secrets with masked values
      const existing = getIntegrationConfig(id) ?? {};

      // Hash-based optimistic concurrency: reject if data changed since client last read
      if (body.hash) {
        const currentHash = computeConfigHash(existing);
        if (body.hash !== currentHash) {
          return reply.status(409).send({
            error: 'Configuration changed since last read',
            code: 'CONFLICT',
            currentHash,
          });
        }
      }
      const merged: IntegrationConfigValues = { ...existing };

      for (const field of schema.fields) {
        const incoming = body.values[field.key];
        if (incoming !== undefined && incoming !== null) {
          // Skip if the incoming value looks like a masked secret (starts with ****)
          if (field.type === 'secret' && incoming.startsWith('****')) {
            continue; // keep existing value
          }
          merged[field.key] = incoming;
        }
      }

      saveIntegrationConfig(id, merged);
      const connected = isIntegrationConnected(id);

      return {
        id,
        connected,
        values: maskValues(merged, schema),
        hash: computeConfigHash(merged),
      };
    }
  );

  // DELETE /api/integrations/:id/config
  fastify.delete<{ Params: { id: string } }>(
    '/api/integrations/:id/config',
    async (request) => {
      const { id } = request.params;
      const schema = getIntegrationSchema(id);
      if (!schema) throw new NotFoundError('Integration', id);

      const removed = deleteIntegrationConfig(id);
      return { id, removed };
    }
  );

  // POST /api/integrations/:id/test
  fastify.post<{ Params: { id: string } }>(
    '/api/integrations/:id/test',
    async (request) => {
      const { id } = request.params;
      const schema = getIntegrationSchema(id);
      if (!schema) throw new NotFoundError('Integration', id);

      const values = getIntegrationConfig(id) ?? {};
      return testConnection(id, values);
    }
  );
}
