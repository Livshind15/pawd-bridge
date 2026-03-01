import 'dotenv/config';
import { config as loadEnv } from 'dotenv';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { resolve } from 'path';

function resolveDataDir(dir: string): string {
  if (dir.startsWith('~')) {
    return resolve(homedir(), dir.slice(2));
  }
  return resolve(dir);
}

// Load API keys from ~/.pawd-bridge/.env if it exists (fallback).
const pawdEnv = resolve(resolveDataDir(process.env.DATA_DIR || '~/.pawd-bridge/data'), '..', '.env');
if (existsSync(pawdEnv)) {
  loadEnv({ path: pawdEnv, override: false });
}

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  dataDir: resolveDataDir(process.env.DATA_DIR || '~/.pawd-bridge/data'),

  /** OAuth token from Claude subscription (primary auth for SDK). */
  claudeOAuthToken: process.env.CLAUDE_CODE_OAUTH_TOKEN || '',
  /** Anthropic API key (fallback auth for SDK). */
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',

  agentWorkspacesDir: resolveDataDir(process.env.AGENT_WORKSPACES_DIR || '~/.pawd-bridge/workspaces'),
  defaultModel: process.env.DEFAULT_MODEL || 'claude-sonnet-4-20250514',
} as const;
