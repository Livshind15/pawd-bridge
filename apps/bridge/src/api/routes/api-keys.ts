import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { FastifyInstance } from 'fastify';
import { config } from '../../config.js';
import { ValidationError } from '../middleware/errors.js';

// ---------------------------------------------------------------------------
// Provider definitions
// ---------------------------------------------------------------------------

const PROVIDER_ENV_MAP: Record<string, string> = {
  'claude-oauth': 'CLAUDE_CODE_OAUTH_TOKEN',
  anthropic: 'ANTHROPIC_API_KEY',
};

const PROVIDER_DISPLAY: Record<string, { name: string; description: string; color: string }> = {
  'claude-oauth': { name: 'Claude Subscription', description: 'OAuth token (Max/Pro plan)', color: '#D97706' },
  anthropic: { name: 'Anthropic API', description: 'Direct API key', color: '#D97706' },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pawdEnvPath(): string {
  return join(dirname(config.dataDir), '.env');
}

function maskKey(key: string): string {
  if (!key || key.length <= 4) return key ? '****' : '';
  return '****' + key.slice(-4);
}

/**
 * Persist an env var to ~/.pawd-bridge/.env for restart survival.
 * Appends or updates the line `KEY=value`.
 */
function persistEnvVar(key: string, value: string): void {
  const envPath = pawdEnvPath();
  let lines: string[] = [];
  if (existsSync(envPath)) {
    lines = readFileSync(envPath, 'utf-8').split('\n');
  }
  const idx = lines.findIndex((l) => l.startsWith(`${key}=`));
  if (idx >= 0) {
    lines[idx] = `${key}=${value}`;
  } else {
    lines.push(`${key}=${value}`);
  }
  writeFileSync(envPath, lines.filter((l) => l.trim() !== '' || l === '').join('\n') + '\n', 'utf-8');
}

function removeEnvVar(key: string): void {
  const envPath = pawdEnvPath();
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, 'utf-8')
    .split('\n')
    .filter((l) => !l.startsWith(`${key}=`));
  writeFileSync(envPath, lines.join('\n') + '\n', 'utf-8');
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function apiKeyRoutes(fastify: FastifyInstance): void {
  // GET /api/api-keys — List supported providers with configuration status
  fastify.get('/api/api-keys', async () => {
    const providers = Object.entries(PROVIDER_ENV_MAP).map(([id, envVar]) => {
      const envValue = process.env[envVar] || '';
      const display = PROVIDER_DISPLAY[id] || { name: id, description: '', color: '#6B7280' };

      return {
        id,
        name: display.name,
        description: display.description,
        color: display.color,
        configured: !!envValue,
        hasKey: !!envValue,
        maskedKey: maskKey(envValue),
      };
    });

    return { providers };
  });

  // PUT /api/api-keys/:provider — Set/update a credential
  fastify.put<{ Params: { provider: string }; Body: { apiKey: string } }>(
    '/api/api-keys/:provider',
    async (request) => {
      const { provider } = request.params;
      const body = request.body as { apiKey?: string };

      if (!PROVIDER_ENV_MAP[provider]) {
        throw new ValidationError(
          `Invalid provider: ${provider}. Must be one of: ${Object.keys(PROVIDER_ENV_MAP).join(', ')}`
        );
      }

      const apiKey = body.apiKey;
      if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
        throw new ValidationError('Body must include "apiKey" as a non-empty string');
      }

      const trimmedKey = apiKey.trim();
      const envVar = PROVIDER_ENV_MAP[provider];

      // Set env var for current process
      process.env[envVar] = trimmedKey;

      // Persist to .env file for restart survival
      persistEnvVar(envVar, trimmedKey);

      return {
        provider,
        configured: true,
        maskedKey: maskKey(trimmedKey),
      };
    }
  );

  // DELETE /api/api-keys/:provider — Remove a credential
  fastify.delete<{ Params: { provider: string } }>(
    '/api/api-keys/:provider',
    async (request) => {
      const { provider } = request.params;

      if (!PROVIDER_ENV_MAP[provider]) {
        throw new ValidationError(
          `Invalid provider: ${provider}. Must be one of: ${Object.keys(PROVIDER_ENV_MAP).join(', ')}`
        );
      }

      const envVar = PROVIDER_ENV_MAP[provider];

      // Unset env var
      delete process.env[envVar];

      // Remove from .env
      removeEnvVar(envVar);

      return { provider, removed: true };
    }
  );
}
