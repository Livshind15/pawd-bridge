import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { PAWD_ENV_FILE } from './paths.js';

/**
 * Read a named env var from process.env or from ~/.pawd/.env.
 */
export function readEnvVar(name: string): string {
  if (process.env[name]) return process.env[name]!;

  if (!existsSync(PAWD_ENV_FILE)) return '';
  try {
    const content = readFileSync(PAWD_ENV_FILE, 'utf-8');
    const re = new RegExp(`^${name}\\s*=\\s*(.+)$`);
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('#') || !trimmed) continue;
      const match = trimmed.match(re);
      if (match) return match[1].replace(/^["']|["']$/g, '');
    }
    return '';
  } catch {
    return '';
  }
}

/** Read ANTHROPIC_API_KEY from env or ~/.pawd/.env. */
export function getAnthropicApiKey(): string {
  return readEnvVar('ANTHROPIC_API_KEY');
}

/** Read CLAUDE_CODE_OAUTH_TOKEN from env or ~/.pawd/.env (subscription auth). */
export function getClaudeOAuthToken(): string {
  return readEnvVar('CLAUDE_CODE_OAUTH_TOKEN');
}

/** Returns whichever SDK credential is available (OAuth token preferred). */
export function getSdkCredential(): { method: 'oauth_token' | 'api_key' | 'none'; value: string } {
  const oauthToken = getClaudeOAuthToken();
  if (oauthToken) return { method: 'oauth_token', value: oauthToken };
  const apiKey = getAnthropicApiKey();
  if (apiKey) return { method: 'api_key', value: apiKey };
  return { method: 'none', value: '' };
}

/**
 * Persist an env var to ~/.pawd/.env (creates file/dir if needed).
 * Appends or updates the line `KEY=value`.
 */
export function persistEnvVar(key: string, value: string): void {
  mkdirSync(dirname(PAWD_ENV_FILE), { recursive: true });
  let lines: string[] = [];
  if (existsSync(PAWD_ENV_FILE)) {
    lines = readFileSync(PAWD_ENV_FILE, 'utf-8').split('\n');
  }
  const idx = lines.findIndex((l) => l.startsWith(`${key}=`));
  if (idx >= 0) {
    lines[idx] = `${key}=${value}`;
  } else {
    lines.push(`${key}=${value}`);
  }
  writeFileSync(PAWD_ENV_FILE, lines.filter((l) => l.trim() !== '' || l === '').join('\n') + '\n', 'utf-8');
  // Also set in current process so subsequent checks pick it up
  process.env[key] = value;
}
